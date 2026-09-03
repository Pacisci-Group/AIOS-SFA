import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  ServiceTicket,
  ServiceTicketDocument,
} from '../crm/schemas/service-ticket.schema';
import { Household } from '../households/schemas/household.schema';
import { Policy } from '../policies/schemas/policy.schema';
import { User } from '../users/schemas/user.schema';
import { buildLegacyTicket } from './helpers/legacy-ticket';
import { MigrationModule } from './migration.module';

/**
 * Fold the two service-ticket collections into one.
 *
 * ## Why this exists
 *
 * The first SmartSuite migration wrote tickets as a thin mirror of the legacy
 * table into `serviceTickets`. The CSR workspace, built three weeks later,
 * modelled tickets properly — numbers, enum-enforced status, timeline,
 * onboarding/renewal steps — and read a *different* collection,
 * `service_tickets`. Nothing reconciled the two, so every imported ticket was
 * invisible to the app and every app-opened ticket was invisible to the import.
 *
 * The schema split is fixed in code (one `ServiceTicket`, collection
 * `serviceTickets`). This script fixes the data that already exists, in three
 * idempotent passes:
 *
 * 1. **Reshape** every mirror row still in `serviceTickets` — recognisable by
 *    having no `ticketNumber` — into the CRM shape, in place, keeping its `_id`
 *    and `legacySmartSuiteId` so a later re-import heals it rather than
 *    duplicating it. Uses the same builder the migration now uses.
 * 2. **Move** every row of `service_tickets` into `serviceTickets` verbatim
 *    (they are already the CRM shape), then drop the empty collection.
 * 3. **Sync indexes**: the collection carries the mirror's indexes, not the
 *    CRM's. Per the repo rule on index changes, the unique ones are checked
 *    for conflicting data *before* anything is dropped.
 *
 * Re-running finds nothing to reshape, nothing to move, and indexes in sync.
 *
 * Boots `MigrationModule` for its models and connection; it does not touch
 * SmartSuite, so no credentials are needed.
 *
 * Flags: `--dry-run` (report only), `--keep-legacy` (move but do not drop
 * `service_tickets`).
 */

const LEGACY_COLLECTION = 'service_tickets';

interface Options {
  dryRun: boolean;
  keepLegacy: boolean;
}

interface Summary {
  reshaped: number;
  reshapeSkipped: string[];
  moved: number;
  alreadyMoved: number;
  moveClashes: string[];
  legacyDropped: boolean;
  indexesDropped: string[];
}

/** A row as the old mirror schema wrote it. */
interface MirrorRow {
  _id: Types.ObjectId;
  agencyId: string | Types.ObjectId;
  branchId?: string | Types.ObjectId | null;
  legacySmartSuiteId?: string;
  title?: string;
  createdDate?: Date;
  category?: string;
  priority?: string;
  status?: string;
  dateResolved?: Date;
  clientName?: string;
  crmName?: string;
  policyId?: Types.ObjectId | null;
  householdId?: Types.ObjectId | null;
  assignedCrmId?: Types.ObjectId | null;
  createdById?: Types.ObjectId | null;
  isTestRecord?: boolean;
  createdAt?: Date;
}

function parseOptions(argv: string[]): Options {
  return {
    dryRun: argv.includes('--dry-run'),
    keepLegacy: argv.includes('--keep-legacy'),
  };
}

function toObjectId(
  value: string | Types.ObjectId | null | undefined,
): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

function displayName(user: {
  firstName?: string;
  lastName?: string;
  email?: string;
}): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    user.email ||
    ''
  );
}

async function reshapeMirrorRows(
  logger: Logger,
  options: Options,
  ticketModel: Model<ServiceTicketDocument>,
  householdModel: Model<Household>,
  policyModel: Model<Policy>,
  userModel: Model<User>,
  summary: Summary,
): Promise<void> {
  // The raw driver, not the model: these rows do not fit the schema yet, and
  // a Mongoose read would strip the very fields we need to map from.
  const rows = (await ticketModel.collection
    .find({ ticketNumber: { $exists: false } })
    .toArray()) as unknown as MirrorRow[];
  logger.log(
    `Reshape: ${rows.length} mirror row(s) in ${ticketModel.collection.name}`,
  );
  if (!rows.length) return;

  // One round-trip per linked collection, keyed by id.
  const ids = (pick: (r: MirrorRow) => Types.ObjectId | null | undefined) =>
    rows.map(pick).filter((id): id is Types.ObjectId => Boolean(id));
  const [households, policies, users] = await Promise.all([
    householdModel
      .find({ _id: { $in: ids((r) => r.householdId) } })
      .select('name primaryContactName primaryPhones primaryEmails')
      .lean(),
    policyModel
      .find({ _id: { $in: ids((r) => r.policyId) } })
      .select('policyNumber policyType')
      .lean(),
    userModel
      .find({ _id: { $in: ids((r) => r.createdById) } })
      .select('firstName lastName email')
      .lean(),
  ]);
  const householdById = new Map(households.map((h) => [String(h._id), h]));
  const policyById = new Map(policies.map((p) => [String(p._id), p]));
  const userById = new Map(users.map((u) => [String(u._id), u]));

  for (const row of rows) {
    const label = `${row.legacySmartSuiteId ?? String(row._id)} (${row.title ?? 'untitled'})`;
    const fields = buildLegacyTicket(
      {
        title: row.title,
        category: row.category,
        status: row.status,
        priority: row.priority,
        clientName: row.clientName,
        crmName: row.crmName,
        createdDate: row.createdDate,
        dateResolved: row.dateResolved,
        policyId: row.policyId ?? undefined,
        householdId: row.householdId ?? undefined,
        assignedUserId: row.assignedCrmId ?? undefined,
        createdByUserId: row.createdById ?? undefined,
        isTestRecord: row.isTestRecord ?? false,
      },
      {
        household: row.householdId
          ? householdById.get(String(row.householdId))
          : null,
        policy: row.policyId ? policyById.get(String(row.policyId)) : null,
        createdByDisplayName: row.createdById
          ? displayName(userById.get(String(row.createdById)) ?? {})
          : null,
      },
    );
    if (!fields) {
      summary.reshapeSkipped.push(label);
      logger.warn(`  skip ${label}: title is not a ticket number`);
      continue;
    }
    const agencyId = toObjectId(row.agencyId);
    if (!agencyId) {
      summary.reshapeSkipped.push(label);
      logger.warn(
        `  skip ${label}: agencyId ${String(row.agencyId)} is not an ObjectId`,
      );
      continue;
    }

    if (!options.dryRun) {
      // Through the model so the schema casts — subdocument ids on the
      // timeline, ObjectIds where the mirror stored strings — and strips the
      // mirror's own fields (`daysOpen`, `crmName`, …), which have no home in
      // the CRM shape. `createdAt` is carried over; `updatedAt` is now.
      await ticketModel.replaceOne(
        { _id: row._id },
        {
          agencyId,
          branchId: toObjectId(row.branchId),
          legacySmartSuiteId: row.legacySmartSuiteId,
          createdAt: row.createdAt,
          ...fields,
        },
      );
    }
    summary.reshaped++;
  }
  logger.log(
    `Reshape: ${summary.reshaped} reshaped, ${summary.reshapeSkipped.length} skipped` +
      (options.dryRun ? ' (dry run — nothing written)' : ''),
  );
}

async function moveLiveRows(
  logger: Logger,
  options: Options,
  connection: Connection,
  ticketModel: Model<ServiceTicketDocument>,
  summary: Summary,
): Promise<void> {
  const db = connection.db;
  if (!db) throw new Error('No database on the Mongoose connection');
  const exists = await db
    .listCollections({ name: LEGACY_COLLECTION })
    .hasNext();
  if (!exists) {
    logger.log(`Move: ${LEGACY_COLLECTION} does not exist — nothing to move`);
    return;
  }

  const legacy = db.collection(LEGACY_COLLECTION);
  const target = ticketModel.collection;
  const rows = await legacy.find({}).toArray();
  logger.log(`Move: ${rows.length} row(s) in ${LEGACY_COLLECTION}`);

  for (const row of rows) {
    const label = `${String(row.ticketNumber)} (${String(row._id)})`;
    if (await target.findOne({ _id: row._id }, { projection: { _id: 1 } })) {
      summary.alreadyMoved++;
      continue;
    }
    // The unique index this collection is about to get. A clash here is a
    // real conflict between a live number and a migrated one; report it and
    // leave the row where it is rather than guess which should win.
    const clash = await target.findOne(
      { agencyId: row.agencyId, ticketNumber: row.ticketNumber },
      { projection: { _id: 1 } },
    );
    if (clash) {
      summary.moveClashes.push(label);
      logger.warn(
        `  clash ${label}: number already in ${target.collectionName}`,
      );
      continue;
    }
    if (!options.dryRun) {
      // Verbatim — it is already the CRM shape, timestamps included.
      await target.insertOne(row);
    }
    summary.moved++;
  }

  const allMoved =
    summary.moved + summary.alreadyMoved === rows.length &&
    summary.moveClashes.length === 0;
  logger.log(
    `Move: ${summary.moved} moved, ${summary.alreadyMoved} already present, ` +
      `${summary.moveClashes.length} clash(es)` +
      (options.dryRun ? ' (dry run — nothing written)' : ''),
  );

  if (options.dryRun || options.keepLegacy) return;
  if (!allMoved) {
    logger.warn(
      `Move: keeping ${LEGACY_COLLECTION} — not every row is accounted for`,
    );
    return;
  }
  await legacy.drop();
  summary.legacyDropped = true;
  logger.log(`Move: dropped ${LEGACY_COLLECTION}`);
}

/**
 * Refuse to rebuild a unique index over data that would violate it. Failing
 * *after* the old index is dropped would leave no uniqueness at all.
 */
async function assertUniqueKeys(
  ticketModel: Model<ServiceTicketDocument>,
): Promise<void> {
  const duplicates = (key: Record<string, string>, match: object) =>
    ticketModel.collection
      .aggregate([
        { $match: match },
        { $group: { _id: key, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $limit: 5 },
      ])
      .toArray();
  const [byNumber, byLegacy] = await Promise.all([
    duplicates(
      { agencyId: '$agencyId', ticketNumber: '$ticketNumber' },
      { ticketNumber: { $type: 'string' } },
    ),
    duplicates(
      { agencyId: '$agencyId', legacySmartSuiteId: '$legacySmartSuiteId' },
      { legacySmartSuiteId: { $type: 'string' } },
    ),
  ]);
  if (byNumber.length || byLegacy.length) {
    throw new Error(
      `Duplicate keys would break the unique indexes: ` +
        JSON.stringify({
          ticketNumber: byNumber,
          legacySmartSuiteId: byLegacy,
        }),
    );
  }
}

async function syncIndexes(
  logger: Logger,
  options: Options,
  ticketModel: Model<ServiceTicketDocument>,
  summary: Summary,
): Promise<void> {
  await assertUniqueKeys(ticketModel);
  if (options.dryRun) {
    const diff = await ticketModel.diffIndexes();
    logger.log(
      `Indexes (dry run): would drop ${JSON.stringify(diff.toDrop)}, ` +
        `would create ${diff.toCreate.length}`,
    );
    return;
  }
  // Drops whatever the schema does not declare — the mirror's `status_1`,
  // `isTestRecord_1`, `assignedCrmId_1`, … — and builds the CRM's.
  summary.indexesDropped = await ticketModel.syncIndexes();
  logger.log(
    `Indexes: dropped ${JSON.stringify(summary.indexesDropped)}, schema indexes ensured`,
  );
}

async function main() {
  const logger = new Logger('ConsolidateServiceTickets');
  const options = parseOptions(process.argv.slice(2));
  logger.log(
    `Consolidating service tickets (dryRun=${options.dryRun}, keepLegacy=${options.keepLegacy})`,
  );

  const app = await NestFactory.createApplicationContext(MigrationModule, {
    logger: ['log', 'warn', 'error'],
  });
  const summary: Summary = {
    reshaped: 0,
    reshapeSkipped: [],
    moved: 0,
    alreadyMoved: 0,
    moveClashes: [],
    legacyDropped: false,
    indexesDropped: [],
  };
  try {
    const connection = app.get<Connection>(getConnectionToken());
    const ticketModel = app.get<Model<ServiceTicketDocument>>(
      getModelToken(ServiceTicket.name),
    );
    const householdModel = app.get<Model<Household>>(
      getModelToken(Household.name),
    );
    const policyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
    const userModel = app.get<Model<User>>(getModelToken(User.name));

    await reshapeMirrorRows(
      logger,
      options,
      ticketModel,
      householdModel,
      policyModel,
      userModel,
      summary,
    );
    await moveLiveRows(logger, options, connection, ticketModel, summary);
    await syncIndexes(logger, options, ticketModel, summary);

    const total = await ticketModel.collection.countDocuments();
    logger.log(
      `Done. ${ticketModel.collection.name} now holds ${total} ticket(s).`,
    );
    console.table({
      reshaped: summary.reshaped,
      reshapeSkipped: summary.reshapeSkipped.length,
      moved: summary.moved,
      alreadyMoved: summary.alreadyMoved,
      moveClashes: summary.moveClashes.length,
      legacyDropped: summary.legacyDropped,
      indexesDropped: summary.indexesDropped.length,
    });
    if (summary.reshapeSkipped.length || summary.moveClashes.length) {
      console.log('Needs a look:', {
        reshapeSkipped: summary.reshapeSkipped,
        moveClashes: summary.moveClashes,
      });
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
