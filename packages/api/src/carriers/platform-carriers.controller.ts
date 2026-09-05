import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformPermission } from '@sfa/shared';
import {
  RequirePermissions,
  SkipBranch,
  SkipModule,
  SkipTenant,
} from '../common/decorators/access.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { CarriersService } from './carriers.service';

/**
 * The carrier catalog, for the Super Admin panel (PAC-93).
 *
 * ## Why not just widen `GET /carriers`
 *
 * That route is gated `@RequireAnyModule(DealAudits, CrmService)`, and a
 * platform operator has **no agency at all** — so there are no module
 * entitlements that could satisfy it. Adding a permission to its OR-list would
 * not help, and widening the *module* gate would mean handing an operator
 * entitlements they conceptually cannot hold. `carrier.schema.ts` anticipated
 * exactly this and reserved the route: "super-admin CRUD at `platform/carriers`
 * under `platform:*` … Do not re-litigate the shape when building those — build
 * the controllers."
 *
 * ## Why `platform:agencies:read` and not a new permission
 *
 * The only reason an operator reads this list is to attach a carrier
 * appointment to an agency, which is squarely agency administration. A
 * `platform:carriers:read` nobody could usefully be granted on its own would be
 * noise in a contract that 91 guard decorators depend on.
 *
 * This is the **read half** of the eventual super-admin carrier CRUD. When the
 * writes land they belong here, beside it, with no schema or route change.
 */
@Controller('platform/carriers')
@SkipTenant()
@SkipBranch()
@SkipModule()
@UseGuards(PermissionsGuard)
export class PlatformCarriersController {
  constructor(private readonly carriers: CarriersService) {}

  /**
   * Every platform-global carrier.
   *
   * `list(null)` is already exactly right: an operator has no tenant whose
   * additions they would be reading, and a global row is the only thing an
   * appointment may target.
   */
  @Get()
  @RequirePermissions(PlatformPermission.AgenciesRead)
  list() {
    return this.carriers.list(null);
  }
}
