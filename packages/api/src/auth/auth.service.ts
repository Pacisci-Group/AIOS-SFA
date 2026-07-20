import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { JwtPayload } from '@sfa/shared';
import { PermissionsService } from '../permissions/permissions.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AcceptInviteDto, LoginDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private permissionsService: PermissionsService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.userModel.findOne({
      email: dto.email.toLowerCase(),
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
      const user = await this.userModel.findById(payload.sub);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      return this.issueTokens(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async acceptInvite(dto: AcceptInviteDto) {
    const user = await this.userModel.findOne({
      inviteToken: dto.token,
      inviteTokenExpiresAt: { $gt: new Date() },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired invite token');
    }

    user.passwordHash = await bcrypt.hash(dto.password, 12);
    user.inviteToken = undefined;
    user.inviteTokenExpiresAt = undefined;
    user.isActive = true;
    await user.save();

    return this.issueTokens(user);
  }

  private async issueTokens(user: UserDocument) {
    const access = await this.permissionsService.buildAccessContext(user);
    // Only slim, stable identity claims are signed into the token. The effective
    // permission set is resolved from the store on every request, not trusted
    // from here.
    const claims = this.permissionsService.buildJwtClaims(access);
    const roles = await this.permissionsService.resolveRoleNames(user);
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null;
    const accessToken = this.jwtService.sign(claims, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.get<string>(
        'JWT_ACCESS_EXPIRES',
        '15m',
      ) as `${number}m`,
    });
    const refreshToken = this.jwtService.sign(claims, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>(
        'JWT_REFRESH_EXPIRES',
        '7d',
      ) as `${number}d`,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        name,
        roles,
        agencyId: access.agencyId,
        branchId: access.branchId,
        permissions: access.permissions,
        scope: access.scope,
        dataScope: access.dataScope,
        isPlatformAdmin: access.isPlatformAdmin,
      },
    };
  }
}
