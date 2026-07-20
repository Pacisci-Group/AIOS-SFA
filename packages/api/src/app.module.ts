import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { AccessContextGuard } from './common/guards/access-context.guard';
import { BranchGuard } from './common/guards/branch.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ModuleGuard } from './common/guards/module.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { BranchesModule } from './branches/branches.module';
import { FeatureModulesModule } from './feature-modules/feature-modules.module';
import { HealthController } from './health.controller';
import { PermissionsModule } from './permissions/permissions.module';
import { PlatformModule } from './platform/platform.module';
import { RolesModule } from './roles/roles.module';
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
    AuthModule,
    PermissionsModule,
    PlatformModule,
    BranchesModule,
    RolesModule,
    UsersModule,
    FeatureModulesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccessContextGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: BranchGuard },
    { provide: APP_GUARD, useClass: ModuleGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
