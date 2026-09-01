import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AgencyDomain,
  AgencyDomainSchema,
} from '../platform/schemas/agency-domain.schema';
import {
  AgencyDomainsController,
  PublicDomainsController,
} from './agency-domains.controller';
import { AgencyDomainsService } from './agency-domains.service';
import { DnsVerifier } from './dns-verifier';

/**
 * `HostTenantResolver` and `TenantUrlService` are not imported here — they come
 * from the `@Global` `TenancyModule`, which also registers the `AgencyDomain`
 * model. It is registered again below because a module must declare the models
 * it injects directly; Mongoose de-duplicates the underlying model.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgencyDomain.name, schema: AgencyDomainSchema },
    ]),
  ],
  controllers: [AgencyDomainsController, PublicDomainsController],
  providers: [AgencyDomainsService, DnsVerifier],
  exports: [AgencyDomainsService],
})
export class AgencyDomainsModule {}
