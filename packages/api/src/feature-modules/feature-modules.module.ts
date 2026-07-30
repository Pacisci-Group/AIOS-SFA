import { Module } from '@nestjs/common';
import {
  CommandCenterController,
  ContactsController,
  CrmServiceController,
  DashboardController,
  DealsController,
  FilesController,
  HouseholdsController,
  LeaderboardController,
  LeadsController,
  MailersController,
  ManagementController,
  OnboardingsController,
  OwnerDashboardController,
  PerformanceController,
  QuoteRecapsController,
} from './feature.controllers';

// NOTE: `deal-audits` is now served by the real `DealAuditsModule`
// (see src/deal-audits), so its stub controller is intentionally omitted here.
const controllers = [
  DashboardController,
  ContactsController,
  HouseholdsController,
  LeadsController,
  QuoteRecapsController,
  DealsController,
  CrmServiceController,
  PerformanceController,
  LeaderboardController,
  MailersController,
  OnboardingsController,
  ManagementController,
  OwnerDashboardController,
  CommandCenterController,
  FilesController,
];

@Module({
  controllers,
})
export class FeatureModulesModule {}
