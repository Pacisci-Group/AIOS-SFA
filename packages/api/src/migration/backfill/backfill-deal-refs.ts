import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import { AppModule } from '../../app.module';
import { Deal } from '../../deals/schemas/deal.schema';
import { Household } from '../../households/schemas/household.schema';
import { Lead } from '../../leads/schemas/lead.schema';
import { Policy } from '../../policies/schemas/policy.schema';
import { normalizePolicyNumber } from '../../policies/policy-number';
import { QuoteRecap } from '../../quote-recaps/schemas/quote-recap.schema';

/**
 * One-off, re-runnable backfill for the refs and keys PAC-40 added.
 *
 * Deliberately **not** part of `api:migrate:dev`. The migration is the
 * SmartSuite import and needs credentials; this only rewrites data already in
 * Mongo, so it must be runnable on its own — including against a database
 * migrated before these fields existed.
 *
 * Two jobs:
 *
 *  1. `deals.leadId` / `householdId` / `quoteRecapId` — the migration writes
 *     only the `legacy*` **string** ids, so a migrated deal has no traversable
 *     link to its lead or household. Audit generation and CRM assignment both
 *     resolve the client through `householdId`, and the hand-off board shows
 *     "Unknown Client" without it.
 *
 *  2. `policies.policyNumberKey` — the normalized match key behind
 *     `GET /policies/check`. Without it the dedupe check silently matches
 *     nothing for every pre-existing policy, which is worse than not having the
 *     check at all: a producer is told a number is free when it is not.
 *
 * Idempotent: every pass only touches documents still missing the target field,
 * so re-running is a no-op. Unmatched rows are counted and reported rather than
 * guessed at — a deal whose legacy lead was never imported must stay unlinked.
 */

interface BackfillCounts {
  scanned: number;
  updated: number;
  unmatched: number;
}

function emptyCounts(): BackfillCounts {
  return { scanned: 0, updated: 0, unmatched: 0 };
}

/** Legacy SmartSuite id -> Mongo `_id`, for one agency's collection. */
async function legacyIdMap(
  model: Model<{ agencyId: string; legacySmartSuiteId?: string }>,
  agencyId: string,
): Promise<Map<string, Types.ObjectId>> {
  const rows = await model
    .find(
      { agencyId, legacySmartSuiteId: { $type: 'string' } },
      { legacySmartSuiteId: 1 },
    )
    .lean<Array<{ _id: Types.ObjectId; legacySmartSuiteId: string }>>();

  return new Map(rows.map((r) => [r.legacySmartSuiteId, r._id]));
}

async function backfillDealRefs(
  dealModel: Model<Deal>,
  leadModel: Model<Lead>,
  householdModel: Model<Household>,
  quoteRecapModel: Model<QuoteRecap>,
  agencyId: string,
): Promise<Record<'lead' | 'household' | 'quoteRecap', BackfillCounts>> {
  const [leads, households, recaps] = await Promise.all([
    legacyIdMap(leadModel as never, agencyId),
    legacyIdMap(householdModel as never, agencyId),
    legacyIdMap(quoteRecapModel as never, agencyId),
  ]);

  const targets = [
    { key: 'lead' as const, legacy: 'legacyLeadId', ref: 'leadId', map: leads },
    {
      key: 'household' as const,
      legacy: 'legacyHouseholdId',
      ref: 'householdId',
      map: households,
    },
    {
      key: 'quoteRecap' as const,
      legacy: 'legacyQuoteRecapId',
      ref: 'quoteRecapId',
      map: recaps,
    },
  ];

  const counts = {
    lead: emptyCounts(),
    household: emptyCounts(),
    quoteRecap: emptyCounts(),
  };

  for (const target of targets) {
    const pending = await dealModel
      .find(
        {
          agencyId,
          [target.legacy]: { $type: 'string' },
          [target.ref]: { $in: [null, undefined] },
        },
        { [target.legacy]: 1 },
      )
      .lean<Array<Record<string, unknown> & { _id: Types.ObjectId }>>();

    const writes: AnyBulkWriteOperation<Deal>[] = [];
    for (const deal of pending) {
      counts[target.key].scanned += 1;
      const legacyId = deal[target.legacy] as string;
      const resolved = target.map.get(legacyId);
      if (!resolved) {
        counts[target.key].unmatched += 1;
        continue;
      }
      writes.push({
        updateOne: {
          filter: { _id: deal._id },
          update: { $set: { [target.ref]: resolved } },
        },
      });
    }

    if (writes.length) {
      const res = await dealModel.bulkWrite(writes);
      counts[target.key].updated = res.modifiedCount ?? 0;
    }
  }

  return counts;
}

async function backfillPolicyNumberKeys(
  policyModel: Model<Policy>,
  agencyId: string,
): Promise<BackfillCounts> {
  const counts = emptyCounts();

  const pending = await policyModel
    .find(
      {
        agencyId,
        policyNumber: { $type: 'string' },
        policyNumberKey: { $in: [null, undefined] },
      },
      { policyNumber: 1 },
    )
    .lean<Array<{ _id: Types.ObjectId; policyNumber: string }>>();

  const writes: AnyBulkWriteOperation<Policy>[] = [];
  for (const policy of pending) {
    counts.scanned += 1;
    const key = normalizePolicyNumber(policy.policyNumber);
    if (!key) {
      // Too short to be a usable match key — leaving it unset is correct, the
      // check endpoint treats a short query as "no opinion" too.
      counts.unmatched += 1;
      continue;
    }
    writes.push({
      updateOne: {
        filter: { _id: policy._id },
        update: { $set: { policyNumberKey: key } },
      },
    });
  }

  if (writes.length) {
    const res = await policyModel.bulkWrite(writes);
    counts.updated = res.modifiedCount ?? 0;
  }

  return counts;
}

function report(label: string, counts: BackfillCounts): void {
  console.log(
    `  ${label.padEnd(22)} scanned=${counts.scanned} updated=${counts.updated} unmatched=${counts.unmatched}`,
  );
}

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);

  const dealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
  const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
  const householdModel = app.get<Model<Household>>(
    getModelToken(Household.name),
  );
  const quoteRecapModel = app.get<Model<QuoteRecap>>(
    getModelToken(QuoteRecap.name),
  );
  const policyModel = app.get<Model<Policy>>(getModelToken(Policy.name));

  // Per agency, so the legacy-id maps stay small and can never resolve a link
  // across a tenant boundary.
  const agencyIds: string[] = await dealModel.distinct('agencyId');
  console.log(`Backfilling ${agencyIds.length} agency/agencies.\n`);

  for (const agencyId of agencyIds) {
    console.log(`Agency ${agencyId}`);
    const deals = await backfillDealRefs(
      dealModel,
      leadModel,
      householdModel,
      quoteRecapModel,
      agencyId,
    );
    report('deals.leadId', deals.lead);
    report('deals.householdId', deals.household);
    report('deals.quoteRecapId', deals.quoteRecap);

    const policies = await backfillPolicyNumberKeys(policyModel, agencyId);
    report('policies.numberKey', policies);
    console.log('');
  }

  console.log('Backfill complete.');
  console.log(
    'Unmatched rows are expected where the legacy record was never imported; ' +
      'they are left untouched rather than guessed at.',
  );

  await app.close();
}

run().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
