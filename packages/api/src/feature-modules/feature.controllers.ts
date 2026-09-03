import { Controller, Get, Patch } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { AgencyId, BranchId } from '../common/decorators/user.decorators';

function createFeatureController(path: string, moduleKey: ModuleKey) {
  // Class-level guard: reading the page requires `{module}:read`.
  @Controller(path)
  @RequireModule(moduleKey)
  @RequirePermissions(modulePermission(moduleKey, 'read'))
  class FeatureController {
    @Get()
    status(
      @AgencyId() agencyId: string | null,
      @BranchId() branchId: string | null,
    ) {
      return {
        module: moduleKey,
        status: 'ready',
        agencyId,
        branchId,
      };
    }

    // Mutating handler: overrides the class read requirement with a write one.
    @Patch()
    @RequireWrite(moduleKey)
    update(@AgencyId() agencyId: string | null) {
      return { module: moduleKey, status: 'updated', agencyId };
    }
  }
  return FeatureController;
}

/**
 * NOTE: there is no `ContactsController` stub any more. PAC-38 replaced it with
 * the real `ContactsModule` (`src/contacts`), which exposes an id-scoped
 * `PATCH /contacts/:id` behind a derived-ownership clamp. Two classes on
 * `@Controller('contacts')` would register silently, first-wins — so the stub
 * had to go in the same commit, not later.
 */
/**
 * @deprecated Superseded by the real `HouseholdRecordsController` in
 * `src/clients` (PAC-89), which serves the paginated Clients list on
 * `GET /households`, and no longer registered.
 *
 * Two classes on `@Controller('households')` register silently, first-wins — so
 * this had to be de-registered in the same commit that added the real handler,
 * exactly as `ContactsController` did for PAC-38. Kept only for symmetry with
 * the stubs below; import the real one, not this.
 */
export const HouseholdsController = createFeatureController(
  'households',
  ModuleKey.Clients,
);
/**
 * @deprecated Superseded by the real `QuoteRecapsController` in
 * `src/quote-recaps` (PAC-39) and no longer registered. Kept only for symmetry
 * with `DealAuditsController` below; import the real one, not this.
 */
export const QuoteRecapsController = createFeatureController(
  'quote-recaps',
  ModuleKey.QuoteRecaps,
);
export const DealsController = createFeatureController(
  'deals',
  ModuleKey.Clients,
);
export const DealAuditsController = createFeatureController(
  'deal-audits',
  ModuleKey.DealAudits,
);
/**
 * NOTE: there is no `PerformanceController` stub any more. PAC-10/PAC-11
 * replaced it with the real `PerformanceModule` (`src/performance`), which
 * serves the Sold and Quoted scorecards. As with `ContactsController` above,
 * the stub had to go in the same commit as the real controller: two classes on
 * `@Controller('performance')` both register, first-wins, and which one answers
 * depends on module import order.
 *
 * Likewise no `LeaderboardController` stub: PAC-13 replaced it with the real
 * `LeaderboardModule` (`src/leaderboard`), and no `CrmServiceController` stub:
 * the CSR work replaced it with the real `CrmModule` (`src/crm`).
 *
 * And no `MailersController` stub: PAC-61 replaced it with the real
 * agency-facing controller in `src/mailers`, which serves
 * `GET /mailers/:controlNumber` and `POST /mailers/log-lead` behind the Mailers
 * drawer. `MailersModule` had already claimed `platform/mailers`, so the stub
 * did not collide until the agency-facing route landed — at which point it had
 * to go in the same commit, for the reason above.
 */
export const OnboardingsController = createFeatureController(
  'onboardings',
  ModuleKey.Onboardings,
);
export const DashboardController = createFeatureController(
  'dashboard',
  ModuleKey.Dashboard,
);
export const ManagementController = createFeatureController(
  'management',
  ModuleKey.Management,
);
export const OwnerDashboardController = createFeatureController(
  'owner-dashboard',
  ModuleKey.OwnerDashboard,
);
export const CommandCenterController = createFeatureController(
  'command-center',
  ModuleKey.CommandCenter,
);
