import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * Self-service profile endpoints (`/me/*`, PAC-81).
 *
 * A separate module rather than part of `AuthModule` on purpose: the avatar
 * path needs `StorageService` (global) and streams image bytes, which has no
 * business in the module half the API imports for `JwtModule`. `AuthModule` is
 * imported for `AuthService` — both mutations return the `GET /auth/me` blob
 * so the client's stored copy can never drift.
 */
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
