import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../../app.module';
import { SequenceService } from '../../common/mongo/sequence.service';
import {
  householdCounterKey,
  reconcileHouseholdRefs,
} from '../../households/household-ref';
import { Household } from '../../households/schemas/household.schema';

/**
 * One-off, re-runnable backfill for `households.householdRef` (PAC-56 #7).
 *
 * Like `backfill-deal-refs`, deliberately **not** part of `api:migrate:dev`: the
 * migration is the SmartSuite import and needs credentials, whereas this only
 * rewrites data already in Mongo and must be runnable against a database
 * migrated or seeded before the field existed.
 *
 * Run it after `api:migrate:dev`. The migration numbers every household whose
 * legacy SmartSuite title was a real `#HH…` and seeds the agency counter above
 * the highest of them; this picks up the remainder — titles that were never
 * numbered (SmartSuite's "Record 1" placeholder, or free text someone typed),
 * and anything created before this field shipped.
 *
 * The work itself lives in `reconcileHouseholdRefs`, shared with the demo seed:
 * seed the counter from what is stored, *then* allocate. That order is the whole
 * correctness argument — see the helper.
 */

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);

  const householdModel = app.get<Model<Household>>(
    getModelToken(Household.name),
  );
  const sequences = app.get(SequenceService);

  // The unique index is what makes a reference trustworthy, and a database
  // migrated before it existed will not have built it yet.
  await householdModel.syncIndexes();

  const agencyIds = await householdModel.distinct('agencyId');
  console.log(
    `Backfilling household refs for ${agencyIds.length} agency/agencies.\n`,
  );

  for (const agencyId of agencyIds) {
    const households = await householdModel.countDocuments({ agencyId });
    const result = await reconcileHouseholdRefs(
      householdModel,
      sequences,
      agencyId,
    );
    const counter = await sequences.peek(householdCounterKey(agencyId));

    console.log(`Agency ${agencyId}`);
    console.log(`  households          ${households}`);
    console.log(`  already numbered    ${result.alreadyNumbered}`);
    console.log(`  counter seeded to   HH-${result.seededTo}`);
    console.log(`  newly allocated     ${result.allocated}`);
    console.log(`  counter now at      HH-${counter}`);
    console.log('');
  }

  console.log('Household reference backfill complete.');

  await app.close();
}

run().catch((error) => {
  console.error('Household reference backfill failed:', error);
  process.exit(1);
});
