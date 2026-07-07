import { Controller, Get } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import { RequireModule, RequirePermissions } from '../common/decorators/access.decorators';
import { AgencyId, BranchId } from '../common/decorators/user.decorators';

function createFeatureController(path: string, moduleKey: ModuleKey) {
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
  }
  return FeatureController;
}

export const ContactsController = createFeatureController(
  'contacts',
  ModuleKey.Clients,
);
export const HouseholdsController = createFeatureController(
  'households',
  ModuleKey.Clients,
);
export const LeadsController = createFeatureController(
  'leads',
  ModuleKey.Leads,
);
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
export const CrmServiceController = createFeatureController(
  'crm/service-tickets',
  ModuleKey.CrmService,
);
export const PerformanceController = createFeatureController(
  'performance',
  ModuleKey.Performance,
);
export const LeaderboardController = createFeatureController(
  'leaderboard',
  ModuleKey.Leaderboard,
);
export const MailersController = createFeatureController(
  'mailers',
  ModuleKey.Mailers,
);
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

@Controller('files')
@RequireModule(ModuleKey.QuoteRecaps)
@RequirePermissions(modulePermission(ModuleKey.QuoteRecaps, 'read'))
export class FilesController {
  @Get()
  status() {
    return { module: 'files', status: 'ready' };
  }
}
