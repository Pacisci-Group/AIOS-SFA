import { Module } from '@nestjs/common';
import {
  CommandCenterController,
  ContactsController,
  DashboardController,
  DealAuditsController,
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

const controllers = [
  DashboardController,
  ContactsController,
  HouseholdsController,
  LeadsController,
  QuoteRecapsController,
  DealsController,
  DealAuditsController,
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
