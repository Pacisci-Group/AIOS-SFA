import { config as loadEnv } from 'dotenv';
import { createConnection, type mongo } from 'mongoose';
import { ENV_FILE_PATH } from '../config/env.config';

/**
 * Point every stored email address at a throwaway domain (default
 * `yopmail.com`), so a **restored production dump** can be exercised locally
 * without mailing a real person.
 *
 * WHY THIS EXISTS
 * ---------------
 * Local `.env` files carry a real `RESEND_API_KEY`, and the dev stack mails
 * for real: an invite, a password reset, a campaign notice or — since PAC-154
 * — a bug report filed through Bruno lands in somebody's actual inbox. After
 * a `mongorestore` of production every address in the database is a real one.
 * Run this once after the restore and they all become `<local>@yopmail.com`,
 * which anyone can read at yopmail.com without an account.
 *
 * USAGE
 * -----
 *   npm run scrub:emails:dev -w @sfa/api -- --dry-run
 *   npm run scrub:emails:dev -w @sfa/api
 *   npm run scrub:emails:dev -w @sfa/api -- --domain example.test
 *   npm run scrub:emails:dev -w @sfa/api -- --keep you@company.com,other@x.com
 *
 * ⚠ Run it through the workspace, not a root alias: root scripts swallow
 * everything after `--`, so `--dry-run` would silently not apply.
 *
 * SAFETY
 * ------
 * - **Refuses to run unless `MONGODB_URI` points at a local host** (`localhost`,
 *   `127.0.0.1`, `::1`, or the compose service `mongo`), and refuses outright
 *   under `NODE_ENV=production`. There is no override flag on purpose: the one
 *   thing this must never do is run against production.
 * - Idempotent: an address already on the target domain is left alone, so a
 *   second run reports zero changes.
 * - `users.email` is unique. Two users whose local parts collide after the
 *   rewrite (`pat@gmail.com` + `pat@yahoo.com`) get `pat@…` and `pat-2@…`,
 *   oldest first, and the mapping is printed so you can still log in.
 * - `--keep` exempts exact addresses (case-insensitive) — your own login, say.
 * - Addresses on a **reserved TLD** (`.local`, `.test`, `.localhost`,
 *   `.example`, `.invalid`) are never touched: they cannot receive mail, and
 *   they are the seed logins (`admin@sfa.local`, `@texasholdings.local`).
 * - Bare driver connection, no models: loading a schema fires `autoIndex`,
 *   which is not this script's business.
 *
 * WHAT IT TOUCHES
 * ---------------
 * Every field that holds a person's address — see {@link TARGETS}. Deliberately
 * **not** touched: `agencies.email.fromLocalPart` / `sendingDomain` (sender
 * configuration, not a recipient), `acmeAccounts.contactEmail` (the TLS
 * account's registration contact; no certificate is ever issued locally), and
 * free text such as notes or ticket bodies.
 */
loadEnv({ path: ENV_FILE_PATH });

/** One field to rewrite. `path` is a dotted Mongo path; arrays are mapped. */
interface Target {
  collection: string;
  path: string;
  /** Add a `-N` suffix on local-part collisions (for a unique index). */
  unique?: boolean;
}

export const TARGETS: readonly Target[] = [
  { collection: 'users', path: 'email', unique: true },
  { collection: 'contacts', path: 'email' },
  { collection: 'mailers', path: 'email' },
  { collection: 'renewalCycles', path: 'email' },
  { collection: 'serviceTickets', path: 'email' },
  { collection: 'onboardings', path: 'email' },
  { collection: 'bugReports', path: 'reporterEmail' },
  { collection: 'agencies', path: 'email.replyTo' },
  { collection: 'mailerCampaigns', path: 'settings.outputRecipients' },
  { collection: 'emailMessages', path: 'to' },
  { collection: 'emailMessages', path: 'from' },
  { collection: 'emailMessages', path: 'replyTo' },
];

export interface ScrubOptions {
  domain: string;
  dryRun: boolean;
  /** Exact addresses to leave untouched, lower-cased. */
  keep: ReadonlySet<string>;
}

export interface ScrubResult {
  /** `collection.path` → documents changed. */
  changed: Record<string, number>;
  /** `users.email` collisions that received a suffix: old → new. */
  renamed: Array<{ from: string; to: string }>;
}

/**
 * Matches the `@domain` of an address wherever it sits in a string, so
 * `Name <pat@example.com>` and a bare `pat@example.com` both rewrite.
 */
const DOMAIN_RE = /@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;

/** TLDs that cannot receive mail (RFC 2606 / 6761) — the seed domains. */
const RESERVED_TLDS = new Set([
  'local',
  'test',
  'localhost',
  'example',
  'invalid',
]);

function isReserved(address: string): boolean {
  const tld = address.slice(address.lastIndexOf('.') + 1);
  return RESERVED_TLDS.has(tld);
}

/** The address portion of a string, lower-cased, or null if there is none. */
function addressIn(value: string): string | null {
  const match = /[^\s<>,;"']+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/.exec(value);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Rewrite the domain of every address inside `value`. Returns the input
 * unchanged when there is nothing to do, so callers can compare by identity.
 */
export function rewriteText(value: string, options: ScrubOptions): string {
  const address = addressIn(value);
  if (!address || options.keep.has(address) || isReserved(address)) {
    return value;
  }
  const target = `@${options.domain}`;
  if (address.endsWith(target)) return value;
  return value.replace(DOMAIN_RE, target);
}

/** `pat@yopmail.com` → `pat-2@yopmail.com`. */
function suffixed(address: string, n: number): string {
  const at = address.indexOf('@');
  return `${address.slice(0, at)}-${n}${address.slice(at)}`;
}

/**
 * Assign the rewritten address for each row of a unique field, suffixing
 * collisions in `_id` order (oldest row keeps the bare local part). Rows whose
 * value does not change are still counted as taken, so a new rewrite can never
 * collide with an address that is already on the target domain.
 */
export function assignUnique(
  rows: Array<{ id: string; value: string }>,
  options: ScrubOptions,
): Map<string, string> {
  const taken = new Set<string>();
  const out = new Map<string, string>();
  // Addresses already on the target domain (or kept) are fixed points: claim
  // them first so a rewrite never lands on one.
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const pending: Array<{ id: string; value: string }> = [];
  for (const row of sorted) {
    const rewritten = rewriteText(row.value, options);
    if (rewritten === row.value) {
      taken.add(row.value.toLowerCase());
    } else {
      pending.push(row);
    }
  }
  for (const row of pending) {
    const base = rewriteText(row.value, options).toLowerCase();
    let candidate = base;
    for (let n = 2; taken.has(candidate); n += 1) {
      candidate = suffixed(base, n);
    }
    taken.add(candidate);
    out.set(row.id, candidate);
  }
  return out;
}

function getPath(doc: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    return acc && typeof acc === 'object'
      ? (acc as Record<string, unknown>)[key]
      : undefined;
  }, doc);
}

async function scrubTarget(
  db: mongo.Db,
  target: Target,
  options: ScrubOptions,
  result: ScrubResult,
): Promise<void> {
  const key = `${target.collection}.${target.path}`;
  const exists = await db
    .listCollections({ name: target.collection }, { nameOnly: true })
    .hasNext();
  if (!exists) {
    result.changed[key] = 0;
    return;
  }

  const collection = db.collection(target.collection);
  const docs = await collection
    .find(
      { [target.path]: { $regex: '@' } },
      { projection: { [target.path]: 1 } },
    )
    .toArray();

  const ops: mongo.AnyBulkWriteOperation[] = [];

  if (target.unique) {
    const rows = docs
      .map((doc) => ({
        id: doc._id.toHexString(),
        value: getPath(doc as Record<string, unknown>, target.path),
      }))
      .filter(
        (row): row is { id: string; value: string } =>
          typeof row.value === 'string',
      );
    const assigned = assignUnique(rows, options);
    for (const row of rows) {
      const next = assigned.get(row.id);
      if (!next) continue;
      const bare = rewriteText(row.value, options).toLowerCase();
      if (next !== bare) result.renamed.push({ from: row.value, to: next });
      ops.push({
        updateOne: {
          filter: {
            _id: docs.find((d) => d._id.toHexString() === row.id)!._id,
          },
          update: { $set: { [target.path]: next } },
        },
      });
    }
  } else {
    for (const doc of docs) {
      const value = getPath(doc, target.path);
      let next: unknown;
      if (typeof value === 'string') {
        next = rewriteText(value, options);
        if (next === value) continue;
      } else if (Array.isArray(value)) {
        let touched = false;
        next = value.map((item: unknown) => {
          if (typeof item !== 'string') return item;
          const rewritten = rewriteText(item, options);
          if (rewritten !== item) touched = true;
          return rewritten;
        });
        if (!touched) continue;
      } else {
        continue;
      }
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { [target.path]: next } },
        },
      });
    }
  }

  result.changed[key] = ops.length;
  if (ops.length > 0 && !options.dryRun) {
    await collection.bulkWrite(ops, { ordered: false });
  }
}

export async function run(
  db: mongo.Db,
  options: ScrubOptions,
): Promise<ScrubResult> {
  const result: ScrubResult = { changed: {}, renamed: [] };
  for (const target of TARGETS) {
    await scrubTarget(db, target, options, result);
  }
  return result;
}

function parseOptions(argv: string[]): ScrubOptions {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const domain = (value('--domain') ?? 'yopmail.com')
    .replace(/^@/, '')
    .toLowerCase();
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) {
    throw new Error(`--domain must be a bare hostname, got "${domain}"`);
  }
  const keep = new Set(
    (value('--keep') ?? '')
      .split(',')
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean),
  );
  return { domain, dryRun: argv.includes('--dry-run'), keep };
}

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'mongo',
]);

/**
 * The host of a Mongo URI, for the local-only guard. A replica-set list
 * (`host1,host2`) is split and every member must be local.
 */
export function isLocalUri(uri: string): boolean {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?([^/?]+)/.exec(uri);
  if (!match || uri.startsWith('mongodb+srv://')) return false;
  return match[1]
    .split(',')
    .every((member) =>
      LOCAL_HOSTS.has(member.replace(/:\d+$/, '').toLowerCase()),
    );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to scrub emails with NODE_ENV=production.');
  }
  const options = parseOptions(process.argv.slice(2));
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/sfa';
  if (!isLocalUri(uri)) {
    throw new Error(
      `Refusing to scrub emails: MONGODB_URI does not point at a local host (${uri.replace(/\/\/[^@]+@/, '//****@')}). This script is for a restored dump only.`,
    );
  }

  console.log(`Connecting to ${uri.replace(/\/\/[^@]+@/, '//****@')}`);
  console.log(`Target domain: @${options.domain}`);
  if (options.keep.size > 0) {
    console.log(`Keeping: ${[...options.keep].join(', ')}`);
  }
  console.log(options.dryRun ? 'DRY RUN — nothing will be written.\n' : '\n');

  const connection = createConnection(uri);
  await connection.asPromise();
  const db = connection.db;
  if (!db) throw new Error('No database handle on the connection');

  try {
    const result = await run(db, options);
    console.log(options.dryRun ? 'Would change:' : 'Changed:');
    for (const [key, count] of Object.entries(result.changed)) {
      console.log(`  ${key.padEnd(36)} ${count}`);
    }
    if (result.renamed.length > 0) {
      console.log(
        '\nusers.email collisions, suffixed (oldest keeps the bare name):',
      );
      for (const { from, to } of result.renamed) {
        console.log(`  ${from}  →  ${to}`);
      }
    }
    console.log('\nDone.');
  } finally {
    await connection.close();
  }
}

// `require.main` rather than a bare call: the unit spec imports the helpers,
// and an import must not connect to whatever `MONGODB_URI` points at.
if (require.main === module) {
  main().catch((error) => {
    console.error(
      'Email scrub failed:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
}
