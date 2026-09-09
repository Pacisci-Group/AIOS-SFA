import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PermissionsModule } from '../permissions/permissions.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PermissionsModule,
    // For the public forgot-password entry point (PAC-81): the mint-and-email
    // path lives on `UsersService` (PAC-79) and is not duplicated here. No
    // cycle — nothing UsersModule imports reaches back into AuthModule.
    UsersModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      // For the agency name on the public invite preview (PAC-58).
      { name: Agency.name, schema: AgencySchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: config.get<string>(
            'JWT_ACCESS_EXPIRES',
            '15m',
          ) as `${number}m`,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
