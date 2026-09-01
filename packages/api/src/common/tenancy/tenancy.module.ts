import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../../branches/schemas/branch.schema';
import {
  AgencyDomain,
  AgencyDomainSchema,
} from '../../platform/schemas/agency-domain.schema';
import { HostTenantResolver } from './host-tenant.resolver';
import { TenantContextResolver } from './tenant-context.resolver';
import { TenantUrlService } from './tenant-url.service';

/**
 * Global tenancy helpers, all three answering a different "which tenant?":
 *
 * - {@link TenantContextResolver} — which `(agencyId, branchId)` a **write**
 *   is filed under, from the authenticated user.
 * - {@link HostTenantResolver} — which agency a **hostname** belongs to.
 * - {@link TenantUrlService} — which hostname an agency's **outbound links**
 *   should use. The inverse of the one above.
 *
 * `@Global` because the guard chain, the mail path and half a dozen feature
 * modules need them, and threading an import through each is how one of them
 * ends up with its own subtly different copy of the rule.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Branch.name, schema: BranchSchema },
      { name: AgencyDomain.name, schema: AgencyDomainSchema },
    ]),
  ],
  providers: [TenantContextResolver, HostTenantResolver, TenantUrlService],
  exports: [TenantContextResolver, HostTenantResolver, TenantUrlService],
})
export class TenancyModule {}
