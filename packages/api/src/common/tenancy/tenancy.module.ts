import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../../branches/schemas/branch.schema';
import { TenantContextResolver } from './tenant-context.resolver';

/**
 * Global tenancy helpers. Provides {@link TenantContextResolver} so every
 * authenticated write path resolves `(agencyId, branchId)` the same way.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Branch.name, schema: BranchSchema }]),
  ],
  providers: [TenantContextResolver],
  exports: [TenantContextResolver],
})
export class TenancyModule {}
