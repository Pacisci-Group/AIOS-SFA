import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccessContext } from '@sfa/shared';
import { Agency, AgencyDocument } from '../../platform/schemas/agency.schema';
import {
  SKIP_MODULE_KEY,
  REQUIRE_ANY_MODULE_KEY,
  REQUIRE_MODULE_KEY,
} from '../decorators/access.decorators';
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

    // AND-set: every listed module must be enabled.
    const requiredModules = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    // OR-set: at least one listed module must be enabled. Pairs with
    // `@RequireAnyPermission` for data that renders on more than one page.
    const anyModules = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_ANY_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredModules?.length && !anyModules?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const access = request.access as AccessContext | undefined;
    if (!access) {
      throw new ForbiddenException('Authentication required');
    }

    if (access.isPlatformAdmin) {
      return true;
    }

    if (!access.agencyId) {
      throw new ForbiddenException('Agency context required');
    }

    const agency = await this.agencyModel.findById(access.agencyId).lean();
    if (!agency) {
      throw new ForbiddenException('Agency not found');
    }

    const isEnabled = (moduleKey: string) =>
      agency.modules?.[moduleKey]?.enabled === true;

    for (const moduleKey of requiredModules ?? []) {
      if (!isEnabled(moduleKey)) {
        throw new ForbiddenException('Module Disabled');
      }
    }

    if (anyModules?.length && !anyModules.some(isEnabled)) {
      throw new ForbiddenException('Module Disabled');
    }

    return true;
  }
}
