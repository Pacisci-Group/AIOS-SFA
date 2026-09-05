import { config as loadEnv } from 'dotenv';
import { carrierSlug } from '@sfa/shared';
import { createConnection, Types } from 'mongoose';
import { ENV_FILE_PATH } from '../../config/env.config';
import {
  CARRIER_APPOINTMENT_LOOKUP_KEY,
  CARRIER_APPOINTMENT_UNIQUE_KEY,
  CARRIER_APPOINTMENT_UNIQUE_OPTIONS,
} from '../../platform/schemas/agency.schema';

/**
 * One-off, re-runnable: `Agency.allstateAgencyId` → an Allstate entry in
 * `Agency.carrierAppointments` (PAC-93).
 *
 * WHY THIS EXISTS
 * ---------------
 * `allstateAgencyId` hard-wired one carrier into the tenant model. It is
 * becoming a routing key (PAC-71 files a mailer row under the agency whose code
 * matches), and not every agency on the platform is an Allstate agency — an
 * independent one holds a different code from each carrier that appointed it.
 * The field is gone from the schema, so every value in a live database has to
 * be carried across.
 *
 * USAGE
 * -----
 *   npm run backfill:appointments:dev -w @sfa/api -- --dry-run
 *   npm run backfill:appointments:dev -w @sfa/api
 *   npm run backfill:appointments:dev -w @sfa/api -- --drop-legacy
 *
 * ⚠ Run it through the workspace, not the root alias: the root scripts swallow
 * everything after `--`, so `npm run api:backfill:appointments:dev -- --dry-run`
 * silently runs without the flag.
 *
 * TWO PHASES, ON PURPOSE
 * ----------------------
 * By default the legacy field is **left in place**, so rolling back is a code
 * revert with the data still intact. `--drop-legacy` is the second pass, run
 * once the deploy is confirmed.
 *
 * SAFETY
 * ------
 * - Discovered by field presence, never a hard-coded list of agencies: which
 *   documents carry the field differs per environment.
 * - The global Allstate carrier must already exist. This script never creates
 *   one — `seedCarriers` owns that catalog, and a second writer would fork it.
 * - A pair already claimed by a *different* agency blocks that agency and is
 *   reported. Checked in the script rather than left to E11000, because the
 *   unique index may not exist yet when this runs.
 * - `codeKey` is asserted non-empty before writing. The unique index's partial
 *   filter is evaluated per *document*, so an agency that qualifies has all its
 *   element keys indexed — including one missing `codeKey`, which would then
 *   collide with any other such agency. Mongoose's `required: true` cannot help
 *   here: this writes through the raw driver.
 * - Idempotent twice over: without `--drop-legacy` the per-agency "already has
 *   this pair" guard is true from the second run onward; with it, the discovery
 *   filter matches nothing.
 * - Connects with a bare Mongoose connection and no models on purpose — loading
 *   the schemas would trigger `autoIndex` and race this script for the very
 *   indexes it creates.
 */

loadEnv({ path: ENV_FILE_PATH });

interface Options {
  dryRun: boolean;
  carrierSlug: string;
  dropLegacy: boolean;
}

function parseOptions(argv: string[]): Options {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string, fallback: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };

  return {
    dryRun: has('--dry-run'),
    dropLegacy: has('--drop-legacy'),
    carrierSlug: value('--carrier-slug', carrierSlug('Allstate')),
  };
}

/** The shape this script reads off an agency. */
interface LegacyAgency {
  _id: Types.ObjectId;
  slug?: string;
  name?: string;
  allstateAgencyId?: string;
  carrierAppointments?: {
    carrierId?: Types.ObjectId;
    codeKey?: string;
  }[];
}

async function run(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/sfa';
  console.log(`Connecting to ${uri.replace(/\/\/[^@]+@/, '//****@')}`);
  if (options.dryRun) console.log('DRY RUN — nothing will be written.\n');
  else console.log('');

  const connection = createConnection(uri);
  await connection.asPromise();
  const db = connection.db;
  if (!db) throw new Error('No database handle on the connection');

  const agencies = db.collection('agencies');

  const carrier = await db
    .collection('carriers')
    .findOne({ agencyId: null, slug: options.carrierSlug });
  if (!carrier) {
    await connection.close();
    throw new Error(
      `No global carrier with slug "${options.carrierSlug}". ` +
        'Run the core seed first (npm run api:seed:dev).',
    );
  }
  const carrierId = carrier._id;
  console.log(`Carrier: ${carrier.name} (${options.carrierSlug})\n`);

  const stale = (await agencies
    .find({ allstateAgencyId: { $type: 'string' } })
    .toArray()) as unknown as LegacyAgency[];

  let migrated = 0;
  let already = 0;
  let blocked = 0;

  for (const agency of stale) {
    const label = agency.slug ?? agency.name ?? agency._id.toString();
    const carrierAgencyCode = (agency.allstateAgencyId ?? '').trim();
    const codeKey = carrierAgencyCode.toUpperCase();

    if (!codeKey) {
      blocked += 1;
      console.error(`✗ ${label}: allstateAgencyId is blank — left untouched`);
      continue;
    }

    const existing = agency.carrierAppointments ?? [];
    if (
      existing.some(
        (row) =>
          row.carrierId?.toString() === carrierId.toString() &&
          row.codeKey === codeKey,
      )
    ) {
      already += 1;
      console.log(`· ${label}: ${carrierAgencyCode} already appointed`);
      if (!options.dryRun && options.dropLegacy) {
        await agencies.updateOne(
          { _id: agency._id },
          { $unset: { allstateAgencyId: '' } },
        );
      }
      continue;
    }

    const holder = await agencies.findOne(
      {
        _id: { $ne: agency._id },
        carrierAppointments: { $elemMatch: { carrierId, codeKey } },
      },
      { projection: { slug: 1, name: 1 } },
    );
    if (holder) {
      blocked += 1;
      console.error(
        `✗ ${label}: ${carrierAgencyCode} is already held by ` +
          `${holder.slug ?? holder.name ?? holder._id.toString()} — left untouched`,
      );
      continue;
    }

    if (!options.dryRun) {
      await agencies.updateOne({ _id: agency._id }, {
        $push: {
          carrierAppointments: {
            carrierId,
            carrierAgencyCode,
            codeKey,
            // The legacy field was the agency's only code, so it is the
            // primary — unless the agency has somehow acquired others first.
            isPrimary: existing.length === 0,
            active: true,
          },
        },
        ...(options.dropLegacy ? { $unset: { allstateAgencyId: '' } } : {}),
      } as Record<string, unknown>);
    }
    migrated += 1;
    console.log(
      `✓ ${label}: ${carrierAgencyCode} → ${carrier.name}` +
        (existing.length === 0 ? ' (primary)' : ''),
    );
  }

  /*
   * Create the indexes here as well as in the schema.
   *
   * Not the AGENTS.md index-rebuild rule — both indexes are new, `autoIndex`
   * creates missing ones happily, and nothing is dropped. This removes the
   * deploy-ordering dependency: if the script runs before an API instance boots
   * with the new schema, the uniqueness constraint would otherwise not exist
   * while appointments were being written.
   *
   * The specs are *imported* rather than restated. `createIndex` is idempotent
   * only when the spec matches exactly, and a drifted copy here would make
   * `autoIndex` throw `IndexOptionsConflict` at the next boot.
   */
  if (!options.dryRun) {
    await agencies.createIndex(
      CARRIER_APPOINTMENT_UNIQUE_KEY,
      CARRIER_APPOINTMENT_UNIQUE_OPTIONS,
    );
    await agencies.createIndex(CARRIER_APPOINTMENT_LOOKUP_KEY);
    console.log('\nCarrier-appointment indexes present.');
  }

  await connection.close();

  console.log(
    `\nDone. migrated=${migrated} already=${already} blocked=${blocked}` +
      (options.dropLegacy ? ' (legacy field dropped)' : ''),
  );

  if (blocked > 0) {
    console.error(
      '\nSome agencies were skipped. A blank code needs filling in; a code ' +
        'held by another agency needs a decision about which agency owns it, ' +
        'and the losing appointment removing. Then re-run.',
    );
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('Carrier-appointment backfill failed:', error);
  process.exit(1);
});
