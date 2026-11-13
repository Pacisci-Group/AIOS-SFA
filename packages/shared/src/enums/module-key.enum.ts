export enum ModuleKey {
  Dashboard = 'dashboard',
  Leads = 'leads',
  QuoteRecaps = 'quote_recaps',
  Mailers = 'mailers',
  CrmService = 'crm_service',
  Clients = 'clients',
  DealAudits = 'deal_audits',
  Onboardings = 'onboardings',
  Management = 'management',
  OwnerDashboard = 'owner_dashboard',
  CommandCenter = 'command_center',
  Performance = 'performance',
  Leaderboard = 'leaderboard',
  /**
   * The Data Export page (PAC-152): curated CSV/XLSX datasets for the agency's
   * data team. Appended last on purpose — `ALL_MODULE_KEYS` order drives the
   * permission catalog's `sortOrder`, and the `data_export_module` migration
   * copies the resulting 130/131.
   */
  DataExport = 'data_export',
  /**
   * The Analytics page (PAC-152, part 2): sales and service breakdowns by any
   * dimension, trends over time and goal pacing, for the agency owner and the
   * branch manager. Appended last for the same reason as `DataExport` — the
   * `analytics_module` migration copies the resulting 140/141.
   */
  Analytics = 'analytics',
  /**
   * The Dash Reconciliation page: the carrier's monthly new-business report
   * matched against the agency's own sales — policies missing from the app,
   * app policies the carrier does not show, and 1-800 policies (bound by an
   * Allstate login that is not one of the agency's producers) for review.
   * Appended last for the same reason as `DataExport` — the
   * `carrier_reconciliation_module` migration copies the resulting 150/151.
   */
  CarrierReconciliation = 'carrier_reconciliation',
}

export const ALL_MODULE_KEYS = Object.values(ModuleKey);
