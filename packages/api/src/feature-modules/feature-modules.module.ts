import { Module } from '@nestjs/common';
import {
  CommandCenterController,
  CrmServiceController,
  DashboardController,
  DealsController,
  HouseholdsController,
  LeaderboardController,
  MailersController,
  ManagementController,
  OnboardingsController,
  OwnerDashboardController,
  PerformanceController,
} from './feature.controllers';

// NOTE: `deal-audits` is now served by the real `DealAuditsModule`
// (see src/deal-audits), `leads` by the real `LeadsModule` (see src/leads),
// `quote-recaps` by the real `QuoteRecapsModule` (see src/quote-recaps), and
// `contacts` by the real `ContactsModule` (see src/contacts), so their stub
// controllers are intentionally omitted here.
//
// `files` is gone entirely: it was a `@Controller('files')` placeholder that
// borrowed the `quote_recaps` module key for want of a better one. The real
// file API for quote documents is `POST /quote-recaps/quote-document/presign`,
// and leaving a second route on the same gate was only ever confusing.
const controllers = [
  DashboardController,
  HouseholdsController,
  DealsController,
  CrmServiceController,
  PerformanceController,
  LeaderboardController,
  MailersController,
  OnboardingsController,
  ManagementController,
  OwnerDashboardController,
  CommandCenterController,
];

@Module({
  controllers,
})
export class FeatureModulesModule {}
