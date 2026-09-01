import { Module } from '@nestjs/common';
import { ShareLinksModule } from '../share-links/share-links.module';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';
import { GoogleAddressClient } from './google-address.client';
import { PublicAddressController } from './public-address.controller';
import { PublicAddressService } from './public-address.service';

/**
 * Address autocomplete (PAC-60) — the authenticated routes and the public
 * share-link ones.
 *
 * Both surfaces share one `AddressService`, so there is exactly one place that
 * decides what `available` means and what a failure returns. `ShareLinksModule`
 * supplies `ShareLinkAccessService` and the `ShareLink` model, which the public
 * routes need because `@Public()` bypasses the whole guard chain.
 *
 * ⚠ Importing `ShareLinksModule` also means its controllers register at
 * whichever position is reached first — `app.module.ts` already lists
 * `ShareLinksModule` ahead of `LeadsModule` for the `/leads/share-links` vs
 * `/leads/:id` collision, and `AddressModule` sits after both, so that ordering
 * is unaffected.
 */
@Module({
  imports: [ShareLinksModule],
  controllers: [AddressController, PublicAddressController],
  providers: [GoogleAddressClient, AddressService, PublicAddressService],
  exports: [AddressService],
})
export class AddressModule {}
