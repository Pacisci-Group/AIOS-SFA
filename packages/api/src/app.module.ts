import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { MongoDuplicateKeyFilter } from './common/filters/mongo-duplicate-key.filter';
import { AccessContextGuard } from './common/guards/access-context.guard';
import { BranchGuard } from './common/guards/branch.guard';
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
import { AuditTemplatesModule } from './audit-templates/audit-templates.module';
import { BranchesModule } from './branches/branches.module';
import { CarriersModule } from './carriers/carriers.module';
import { ClientsModule } from './clients/clients.module';
import { CrmModule } from './crm/crm.module';
import { ContactsModule } from './contacts/contacts.module';
import { DealAuditsModule } from './deal-audits/deal-audits.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
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
export class AppModule {}
