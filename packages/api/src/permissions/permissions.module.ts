import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AccessResolverService } from './access-resolver.service';
import { PermissionCache } from './cache/permission-cache';
import { permissionCacheProvider } from './cache/permission-cache.provider';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: Agency.name, schema: AgencySchema },
    ]),
  ],
  providers: [
    PermissionsService,
    AccessResolverService,
    permissionCacheProvider,
  ],
  exports: [
    PermissionsService,
    AccessResolverService,
    PermissionCache,
    MongooseModule,
  ],
})
export class PermissionsModule {}
