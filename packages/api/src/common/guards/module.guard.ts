import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtPayload } from '@sfa/shared';
import { Agency, AgencyDocument } from '../../platform/schemas/agency.schema';
import { SKIP_MODULE_KEY, REQUIRE_MODULE_KEY } from '../decorators/access.decorators';
import { isPublicRoute } from './guard.utils';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) {
      return true;
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const requiredModules = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredModules?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.isPlatformAdmin) {
      return true;
    }

    if (!user.agencyId) {
      throw new ForbiddenException('Agency context required');
    }

    const agency = await this.agencyModel.findById(user.agencyId).lean();
    if (!agency) {
      throw new ForbiddenException('Agency not found');
    }

    for (const moduleKey of requiredModules) {
      const entitlement = agency.modules?.[moduleKey];
      if (!entitlement?.enabled) {
        throw new ForbiddenException('Module Disabled');
      }
    }

    return true;
  }
}
