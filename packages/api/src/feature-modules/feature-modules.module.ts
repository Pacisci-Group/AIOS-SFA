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
  MailersController,
  ManagementController,
  OnboardingsController,
  OwnerDashboardController,
  PerformanceController,
  QuoteRecapsController,
} from './feature.controllers';

// NOTE: `deal-audits` is now served by the real `DealAuditsModule`
// (see src/deal-audits) and `leads` by the real `LeadsModule` (see src/leads),
// so their stub controllers are intentionally omitted here.
const controllers = [
  DashboardController,
  ContactsController,
  HouseholdsController,
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
