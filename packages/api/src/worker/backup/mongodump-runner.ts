import { spawn } from 'child_process';
import { readdir, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';

/** Every snapshot's scratch directory starts with this, so a sweep can find strays. */
export const TEMP_DIR_PREFIX = 'sfa-db-backup-';

/** A scratch directory older than this is debris from a killed run. */
const STALE_TEMP_DIR_MS = 24 * 60 * 60_000;

/** How much of mongodump's stderr is kept for an error message. */
const STDERR_TAIL_BYTES = 16 * 1024;

/** `mongodump --version` answers instantly; anything slower is broken. */
const VERSION_TIMEOUT_MS = 15_000;

export interface MongoDumpOptions {
  uri: string;
  /** A private scratch directory; the credentials file is written here. */
  dir: string;
  archivePath: string;
  timeoutMs: number;
  numParallelCollections: number;
}

/**
 * Runs `mongodump` (PAC-172) — the first external binary the API package runs.
 *
 * ## What the archive is
 * `--archive --gzip` of the database named in `MONGODB_URI` (`/sfa`): the URI's
 * path scopes the dump, so there is no `--db`, which the tools reject alongside
 * a URI that names one. There is also no `--oplog` — that needs a whole-instance
 * dump — so an archive taken while the app writes is **not** point-in-time
 * consistent across collections. At our write volume, on a Sunday at 03:00
 * Chicago time, that is accepted; when an exact instant matters, DigitalOcean's
 * point-in-time fork is the tool (see DEPLOYMENT.md, "Database backups").
 *
 * ## Credentials never reach the command line
 * The URI carries the database password, and argv is readable by every process
 * on the host (`ps`, `/proc/<pid>/cmdline`). It goes in a 0600 YAML file in the
 * run's own scratch directory instead, passed with `--config`, and is masked in
 * every log line and error.
 *
 * ## Why `spawn`, and never a shell
 * No shell means no quoting to get wrong around a URI full of `&` and `?`.
 * `spawn` rather than `execFile` because mongodump logs progress to stderr for
 * the whole run, and `execFile`'s `maxBuffer` would kill a long dump that
 * overflowed it; here only a bounded tail is kept, for the error message.
 *
 * ## TLS
 * mongodump is a Go binary and verifies the managed cluster against the system
 * bundle (`/etc/ssl/certs/ca-certificates.crt`, installed explicitly in the
 * Dockerfile). If a cluster ever needs a private CA, add `sslCAFile:` to
 * {@link mongoToolsConfigYaml} from `doctl databases get-ca`.
 */
@Injectable()
export class MongoDumpRunner {
  private readonly logger = new Logger(MongoDumpRunner.name);

  /** First line of `mongodump --version`. Throws `ENOENT` if it is not installed. */
  async version(): Promise<string> {
    const { stdout } = await runProcess(['--version'], VERSION_TIMEOUT_MS);
    return stdout.split('\n')[0]?.trim() || 'mongodump (unknown version)';
  }

  /**
   * One dump. A retried step that lands here while an earlier attempt's dump is
   * still running joins it in `DbBackupSnapshotFn` rather than calling this
   * again, so this does not guard against overlap itself.
   */
  async run(options: MongoDumpOptions): Promise<{ durationMs: number }> {
    const started = Date.now();
    const configPath = join(options.dir, 'mongodump.yaml');
    await writeFile(configPath, mongoToolsConfigYaml(options.uri), {
      mode: 0o600,
    });
    await runProcess(
      buildArgs({
        configPath,
        archivePath: options.archivePath,
        numParallelCollections: options.numParallelCollections,
      }),
      options.timeoutMs,
      options.uri,
    );
    return { durationMs: Date.now() - started };
  }

  /**
   * Remove scratch directories left behind by a run that was killed outright
   * (container restarted mid-dump), where `finally` never ran. Best-effort:
   * failing to tidy up must never fail a snapshot.
   */
  async sweepStaleTempDirs(now = Date.now()): Promise<void> {
    const root = tmpdir();
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.startsWith(TEMP_DIR_PREFIX)) continue;
      const path = join(root, name);
      try {
        const { mtimeMs } = await stat(path);
        if (now - mtimeMs < STALE_TEMP_DIR_MS) continue;
        await rm(path, { recursive: true, force: true });
        this.logger.warn(`Removed stale snapshot scratch directory ${path}.`);
      } catch {
        // Gone already, or not ours to remove.
      }
    }
  }
}

/** The arguments, without the URI — which is in the config file. */
export function buildArgs(options: {
  configPath: string;
  archivePath: string;
  numParallelCollections: number;
}): string[] {
  return [
    `--config=${options.configPath}`,
    `--archive=${options.archivePath}`,
    '--gzip',
    `--numParallelCollections=${options.numParallelCollections}`,
  ];
}

/**
 * The tools' `--config` file: one double-quoted YAML scalar, so nothing in a
 * URI (`?`, `&`, `#`, `:`) is read as YAML syntax.
 */
export function mongoToolsConfigYaml(uri: string): string {
  const escaped = uri.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `uri: "${escaped}"\n`;
}

/** `mongodb+srv://user:pass@host/db` → `mongodb+srv://****@host/db`. */
export function maskUri(uri: string): string {
  return uri.replace(/\/\/[^@]+@/, '//****@');
}

/**
 * Spawn mongodump and wait for it.
 *
 * Rejects with the spawn error itself (so `ENOENT` keeps its `code`) when the
 * binary is missing, and with an `Error` carrying the exit code and the masked
 * tail of stderr otherwise. A run past `timeoutMs` is SIGKILLed — a wedged dump
 * must not outlive the step that started it.
 */
function runProcess(
  args: string[],
  timeoutMs: number,
  uri?: string,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('mongodump', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout = tail(stdout + chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = tail(stderr + chunk);
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout });
        return;
      }
      const why = timedOut
        ? `was killed after ${Math.round(timeoutMs / 60_000)} minute(s) (DB_BACKUP_DUMP_TIMEOUT_MINUTES)`
        : signal
          ? `was killed by ${signal}`
          : `exited with code ${code}`;
      reject(new Error(`mongodump ${why}: ${redact(lastLines(stderr), uri)}`));
    });
  });
}

function tail(value: string): string {
  return value.length > STDERR_TAIL_BYTES
    ? value.slice(-STDERR_TAIL_BYTES)
    : value;
}

function lastLines(value: string, count = 20): string {
  const lines = value.trim().split('\n').slice(-count).join('\n');
  return lines || '(no output)';
}

/** Mask the URI wherever the tools echo it back, in full or in the usual shape. */
function redact(text: string, uri: string | undefined): string {
  const exact = uri ? text.split(uri).join(maskUri(uri)) : text;
  return exact.replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/g, '$1****@');
}
