import { Module } from '@nestjs/common';
import {
  CommandCenterController,
  DashboardController,
  DealsController,
  ManagementController,
  OnboardingsController,
  OwnerDashboardController,
} from './feature.controllers';

// NOTE: `deal-audits` is now served by the real `DealAuditsModule`
// (see src/deal-audits), `leads` by the real `LeadsModule` (see src/leads),
// `quote-recaps` by the real `QuoteRecapsModule` (see src/quote-recaps),
// `contacts` by the real `ContactsModule` (see src/contacts),
// `crm/service-tickets` by the real `CrmModule` (see src/crm), `performance` by
// the real `PerformanceModule` (see src/performance) and `leaderboard` by the
// real `LeaderboardModule` (see src/leaderboard), and `mailers` by the real
// agency-facing `MailersController` in `MailersModule` (see src/mailers,
// PAC-61), and `households` by the real `HouseholdRecordsController` in
// `ClientsModule` (see src/clients, PAC-89), so their stub controllers are
// intentionally omitted here.
//
// `files` is gone entirely: it was a `@Controller('files')` placeholder that
// borrowed the `quote_recaps` module key for want of a better one. The real
// file API for quote documents is `POST /quote-recaps/quote-document/presign`,
// and leaving a second route on the same gate was only ever confusing.
const controllers = [
  DashboardController,
  DealsController,
  OnboardingsController,
  ManagementController,
  OwnerDashboardController,
  CommandCenterController,
];

@Module({
  controllers,
})
export class FeatureModulesModule {}
