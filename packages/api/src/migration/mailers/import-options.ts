/**
 * Command-line options for the BigQuery mailer backfill.
 *
 * Its own file for the same reason `bigquery-rows.ts` is: the CLI entry point
 * calls `main()` at module scope, so a test cannot import it.
 *
 * Every flag is validated before anything connects, and an unknown flag is an
 * error rather than ignored. This script writes to production, and
 * `--add-onyl` quietly running a full upsert is the expensive kind of typo.
 */
export interface BackfillOptions {
  /** Read, map and count, and write nothing: no mailers, campaigns or leads. */
  dryRun: boolean;
  /** Delete every BigQuery-sourced mailer first. Full runs only. */
  fresh: boolean;
  limit?: number;
  batchSize: number;
  /** Exact `FileName`s to read. Combined with `ingestedSince` by OR. */
  fileNames: string[];
  /** ISO instant: rows uploaded to BigQuery at or after it. */
  ingestedSince?: string;
  /** Exact `FileName` → ticker, for files whose name does not start with one. */
  assignments: Map<string, string>;
  /** Insert mailers AIOS does not hold yet; never modify a stored one. */
  addOnly: boolean;
  /** Stamped on `source.runId` of every mailer this run writes. */
  runId: string;
  /** Link leads waiting on a control number to the mailers this run wrote. */
  linkLeads: boolean;
  /** Where to write the JSON report, relative to the working directory. */
  reportPath?: string;
}

const BOOLEAN_FLAGS: readonly string[] = [
  '--dry-run',
  '--fresh',
  '--add-only',
  '--link-leads',
];
const VALUE_FLAGS: readonly string[] = [
  '--limit',
  '--batch-size',
  '--file',
  '--ingested-since',
  '--assign-file',
  '--run-id',
  '--report',
];
const REPEATABLE_FLAGS: readonly string[] = ['--file', '--assign-file'];

/** The run id the cutover run stamped on every mailer it wrote. */
export function defaultRunId(tableId: string): string {
  return `bigquery:${tableId}`;
}

export function parseBackfillOptions(
  argv: readonly string[],
  tableId: string,
): BackfillOptions {
  const flags = new Set<string>();
  const values = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (BOOLEAN_FLAGS.includes(arg)) {
      flags.add(arg);
      continue;
    }
    if (!VALUE_FLAGS.includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} needs a value.`);
    }
    const list = values.get(arg) ?? [];
    if (list.length > 0 && !REPEATABLE_FLAGS.includes(arg)) {
      throw new Error(`${arg} was given more than once.`);
    }
    list.push(value);
    values.set(arg, list);
    index += 1;
  }

  const single = (flag: string) => values.get(flag)?.[0];

  const fileNames = [
    ...new Set(
      (values.get('--file') ?? []).map((name) => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('--file cannot be blank.');
        return trimmed;
      }),
    ),
  ];

  const assignments = new Map<string, string>();
  for (const raw of values.get('--assign-file') ?? []) {
    const [fileName, ticker] = parseFileAssignment(raw);
    const previous = assignments.get(fileName);
    if (previous && previous !== ticker) {
      throw new Error(
        `--assign-file gives "${fileName}" two tickers, ${previous} and ${ticker}.`,
      );
    }
    assignments.set(fileName, ticker);
  }

  const since = single('--ingested-since');
  const ingestedSince =
    since === undefined ? undefined : parseInstant('--ingested-since', since);
  const hasSelection = fileNames.length > 0 || ingestedSince !== undefined;

  const addOnly = flags.has('--add-only');
  const fresh = flags.has('--fresh');
  const runId = single('--run-id')?.trim();

  if (fresh && (hasSelection || addOnly)) {
    // `--fresh` deletes every BigQuery mailer before reading. Followed by a run
    // that only re-reads a handful of files, it would empty the collection.
    throw new Error('--fresh is only allowed on a full run.');
  }
  if (addOnly && !runId) {
    throw new Error(
      '--add-only needs its own --run-id, so everything the run inserts can be ' +
        'found (and removed) by it.',
    );
  }
  if (addOnly && runId === defaultRunId(tableId)) {
    throw new Error(
      `--run-id ${runId} is the cutover run's id. Deleting this run's mailers ` +
        'by it would delete every mailer the cutover imported.',
    );
  }
  if (hasSelection) {
    for (const fileName of assignments.keys()) {
      if (!fileNames.includes(fileName)) {
        // An assignment for a file the query never returns does nothing, which
        // is almost always a misspelt name rather than an intent.
        throw new Error(
          `--assign-file names "${fileName}", but no --file selects it.`,
        );
      }
    }
  }

  return {
    dryRun: flags.has('--dry-run'),
    fresh,
    limit: positiveInteger('--limit', single('--limit')),
    batchSize: positiveInteger('--batch-size', single('--batch-size')) ?? 1000,
    fileNames,
    ingestedSince,
    assignments,
    addOnly,
    runId: runId || defaultRunId(tableId),
    linkLeads: flags.has('--link-leads'),
    reportPath: single('--report'),
  };
}

/**
 * `April_P (3)=SFA` → `['April_P (3)', 'SFA']`.
 *
 * Splits on the **last** `=`, so a file name containing one still parses. The
 * name is matched exactly (trimmed), never as a prefix: a prefix rule is what
 * skipped these files in the first place, and a looser one would start
 * claiming files nobody named.
 */
export function parseFileAssignment(raw: string): [string, string] {
  const at = raw.lastIndexOf('=');
  const fileName = at > 0 ? raw.slice(0, at).trim() : '';
  const ticker =
    at > 0
      ? raw
          .slice(at + 1)
          .trim()
          .toUpperCase()
      : '';
  if (!fileName || !/^[A-Z]+$/.test(ticker)) {
    throw new Error(
      `--assign-file expects FileName=TICKER (e.g. "April_P (3)=SFA"), not "${raw}".`,
    );
  }
  return [fileName, ticker];
}

function parseInstant(flag: string, raw: string): string {
  const trimmed = raw.trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    // A bare local time selects a different set of rows on every machine.
    throw new Error(
      `${flag} must include a timezone (e.g. 2026-09-09T20:13:00Z), not "${raw}".`,
    );
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${flag} is not a valid date: "${raw}".`);
  }
  return date.toISOString();
}

function positiveInteger(
  flag: string,
  raw: string | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) === 0) {
    throw new Error(`${flag} must be a positive integer, not "${raw}".`);
  }
  return Number(raw);
}
