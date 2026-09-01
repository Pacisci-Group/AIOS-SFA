import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { Connection } from 'mongoose';
import { AuthModule } from './auth/auth.module';
import { HostTenantMiddleware } from './common/context/host-tenant.middleware';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { authorshipPlugin } from './common/mongo/authorship.plugin';
import { MongoDuplicateKeyFilter } from './common/filters/mongo-duplicate-key.filter';
import { AccessContextGuard } from './common/guards/access-context.guard';
import { BranchGuard } from './common/guards/branch.guard';
import { HostTenantGuard } from './common/guards/host-tenant.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ModuleGuard } from './common/guards/module.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { TrustedProxyThrottlerGuard } from './common/guards/trusted-proxy-throttler.guard';
import { MongoModule } from './common/mongo/mongo.module';
import { TenancyModule } from './common/tenancy/tenancy.module';
import {
  DEFAULT_LONG_LIMIT,
  DEFAULT_SHORT_LIMIT,
  HOUR_MS,
  MINUTE_MS,
} from './config/rate-limit.config';
import { ActivitiesModule } from './activities/activities.module';
import { AgencyDomainsModule } from './agency-domains/agency-domains.module';
import { AgencyEmailModule } from './agency-email/agency-email.module';
import { AuditTemplatesModule } from './audit-templates/audit-templates.module';
import { BranchesModule } from './branches/branches.module';
import { CarriersModule } from './carriers/carriers.module';
import { ClientsModule } from './clients/clients.module';
import { CrmModule } from './crm/crm.module';
import { ContactsModule } from './contacts/contacts.module';
import { DealAuditsModule } from './deal-audits/deal-audits.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { MailersModule } from './mailers/mailers.module';
import { LeadsModule } from './leads/leads.module';
import { PerformanceModule } from './performance/performance.module';
import { PoliciesModule } from './policies/policies.module';
import { QuoteRecapsModule } from './quote-recaps/quote-recaps.module';
import { FeatureModulesModule } from './feature-modules/feature-modules.module';
import { HealthController } from './health.controller';
import { PermissionsModule } from './permissions/permissions.module';
import { PlatformModule } from './platform/platform.module';
import { RolesModule } from './roles/roles.module';
import { ShareLinksModule } from './share-links/share-links.module';
import { SoldDealsModule } from './sold-deals/sold-deals.module';
import { StorageModule } from './storage/storage.module';
import { TenantBrandingModule } from './tenant-branding/tenant-branding.module';
import { UsersModule } from './users/users.module';
import { ENV_FILE_PATH } from './config/env.config';
import { InngestModule } from './inngest/inngest.module';
import { WorkerModule } from './worker/worker.module';

/**
 * Whether async work runs inside this process.
 *
 * True today because traffic is low and one container is simpler to operate.
 * Set `WORKER_INLINE=false` and start the `worker` compose profile to move it
 * to its own process — `dist/worker.js` boots the identical module set.
 *
 * ⚠ Exactly one of the two must serve the functions. If the API runs them
 * inline *and* a worker container is up, both register with Inngest under the
 * same app id and the last one to sync wins — so events land on whichever
 * process happens to have synced most recently. Hence a single flag rather than
 * two independent switches.
 *
 * Read from `process.env` rather than `ConfigService` because it is needed to
 * build the module graph, which happens before DI exists. It must therefore be
 * a real environment variable (compose `environment:`), not a line in the repo
 * `.env` — the same constraint `config/rate-limit.config.ts` documents.
 */
const WORKER_INLINE = process.env.WORKER_INLINE !== 'false';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATH }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI', 'mongodb://localhost:27017/sfa'),
        /*
         * `createdBy` / `updatedBy` for every collection that declares them
         * (PAC-72). Registered on the connection rather than per-schema so a
         * new collection is covered by extending `TenantRecord` and nothing
         * else.
         *
         * Must run here: a connection plugin applies to models compiled
         * *after* it, and every `MongooseModule.forFeature` in the graph
         * resolves after the root connection.
         *
         * `onConnectionCreate` rather than `connectionFactory` — same hook
         * point, but it is typed `(connection: Connection) => void` while
         * `connectionFactory` is `(connection: any) => any`.
         */
        onConnectionCreate: (connection: Connection) => {
          connection.plugin(authorshipPlugin);
        },
      }),
    }),
    // In-memory storage on purpose. Redis is optional in this codebase (there is
    // a NoopPermissionCache fallback), so a Redis-backed throttler would
    // silently degrade to *unlimited* whenever Redis was down — strictly worse
    // than per-instance limits.
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'short', ttl: MINUTE_MS, limit: DEFAULT_SHORT_LIMIT },
        { name: 'long', ttl: HOUR_MS, limit: DEFAULT_LONG_LIMIT },
      ],
    }),
    MongoModule,
    TenancyModule,
    // Global. Every producer sends through InngestService; nothing imports the
    // worker directly.
    InngestModule,
    AuthModule,
    PermissionsModule,
    PlatformModule,
    // White-labelling. Both route under their own prefixes (`agency/domains`,
    // `agency/branding`, `public/*`), so neither participates in the route
    // ordering hazards documented further down.
    AgencyDomainsModule,
    AgencyEmailModule,
    TenantBrandingModule,
    BranchesModule,
    RolesModule,
    UsersModule,
    /*
     * Must precede **CrmModule**, not merely ClientsModule, so `/policies/check`
     * is registered ahead of `/policies/:id`. "check" is not a valid ObjectId,
     * so while `:id` won the duplicate check answered 404 for every caller and
     * the Sold wizard silently lost its duplicate warning.
     *
     * Third instance of the same hazard — see ShareLinksModule and ClientsModule
     * below — with the twist that made it hard to spot: **a module is
     * instantiated when it is first reached, including transitively.**
     * `CrmModule` imports `ClientsModule`, so ClientsModule's routes register at
     * CrmModule's position, not at its own. Ordering against the module that
     * *declares* the colliding controller is not enough; it has to precede
     * whatever pulls it in first.
     *
     * Pinned by the "Policies (PAC-40 duplicate check)" e2e block.
     */
    PoliciesModule,
    CrmModule,
    // Registered before FeatureModulesModule so the real `/households/:id`
    // read is matched ahead of the `/households` stub controller.
    ClientsModule,
    StorageModule,
    DealAuditsModule,
    // Before LeadsModule so `/leads/share-links` is registered ahead of
    // `/leads/:id` (PAC-38), which would otherwise shadow it. Pinned by an e2e
    // assertion in "Leads (PAC-38 detail)".
    ShareLinksModule,
    LeadsModule,
    ContactsModule,
    QuoteRecapsModule,
    // The Sold wizard's carrier vocabulary (PAC-56 #19). Also registers the
    // `carriers` model so its indexes build and the core seed can inject it.
    CarriersModule,
    SoldDealsModule,
    PerformanceModule,
    LeaderboardModule,
    ActivitiesModule,
    // Super Admin mailer imports (PAC-73). Registers the `mailers` and
    // `mailerImportRuns` models so their indexes build; it routes on
    // `platform/mailers`, so it does not collide with the `mailers` module
    // stub still served by FeatureModulesModule for the agency-facing page.
    MailersModule,
    // Registers the `auditTemplates` model so its indexes build and the core
    // seed / audit generation can inject it (PAC-40).
    AuditTemplatesModule,
    FeatureModulesModule,
    // Last: it registers no controllers, so it has no bearing on the route
    // ordering the comments above are careful about.
    ...(WORKER_INLINE ? [WorkerModule] : []),
  ],
  controllers: [HealthController],
  providers: [
    // Order is load-bearing: Nest runs global guards in registration order, so
    // throttling must come FIRST — a flood is then rejected before JWT
    // verification and before AccessContextGuard's database round-trip.
    { provide: APP_GUARD, useClass: TrustedProxyThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccessContextGuard },
    // White-labelling: binds the session to the hostname it arrived on. Must
    // sit AFTER AccessContextGuard (it compares `access.agencyId`) and BEFORE
    // TenantGuard, so a token replayed against another agency's host is
    // rejected before any tenant is resolved for it.
    { provide: APP_GUARD, useClass: HostTenantGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: BranchGuard },
    { provide: APP_GUARD, useClass: ModuleGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // A duplicate key is a caller-visible conflict (409), not a 500. Without
    // this the driver's raw error — which echoes the stored values that
    // collided — reaches the default handler.
    { provide: APP_FILTER, useClass: MongoDuplicateKeyFilter },
  ],
})
export class AppModule implements NestModule {
  /**
   * Two per-request middlewares, in this order:
   *
   * 1. {@link RequestContextMiddleware} opens the per-request context store for
   *    every route (PAC-72). Middleware, not an interceptor: the store has to be
   *    established synchronously around the whole request so every async
   *    continuation inherits it — see `runWithRequestContext`. It runs before
   *    the guards, which is why the store starts empty and `AccessContextGuard`
   *    fills in the user.
   * 2. {@link HostTenantMiddleware} resolves the request's `Host` to a tenant.
   *    Middleware rather than a guard because `@Public()` routes need it too —
   *    the login form and the branding bootstrap are both unauthenticated and
   *    both have to know which agency's host they are on.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, HostTenantMiddleware)
      .forRoutes('*');
  }
}
