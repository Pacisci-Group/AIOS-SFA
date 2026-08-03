import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Policy, PolicySchema } from './schemas/policy.schema';

/**
 * Policies (PAC-40).
 *
 * The schema existed but was registered nowhere, so its indexes were never
 * built and no runtime code could inject the model. Registering it is a
 * prerequisite for both the `policyNumberKey` backfill and
 * `GET /policies/check`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Policy.name, schema: PolicySchema }]),
  ],
  exports: [MongooseModule],
})
export class PoliciesModule {}
