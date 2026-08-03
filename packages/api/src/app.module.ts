import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
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
import { BranchesModule } from './branches/branches.module';
import { DealAuditsModule } from './deal-audits/deal-audits.module';
import { LeadsModule } from './leads/leads.module';
import { QuoteRecapsModule } from './quote-recaps/quote-recaps.module';
import { FeatureModulesModule } from './feature-modules/feature-modules.module';
import { HealthController } from './health.controller';
import { PermissionsModule } from './permissions/permissions.module';
import { PlatformModule } from './platform/platform.module';
import { RolesModule } from './roles/roles.module';
import { ShareLinksModule } from './share-links/share-links.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { ENV_FILE_PATH } from './config/env.config';

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
    AuthModule,
    PermissionsModule,
    PlatformModule,
    BranchesModule,
    RolesModule,
    UsersModule,
    StorageModule,
    DealAuditsModule,
    // Before LeadsModule so `/leads/share-links` is registered ahead of any
    // future `/leads/:id` route, which would otherwise shadow it.
    ShareLinksModule,
    LeadsModule,
    QuoteRecapsModule,
    FeatureModulesModule,
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
  ],
})
export class AppModule {}
