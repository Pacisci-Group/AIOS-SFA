import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessScope, DataScope, JwtPayload } from '@sfa/shared';
import { BRANCH_HEADER } from '../constants/permissions.constants';
import { SKIP_BRANCH_KEY } from '../decorators/access.decorators';
import { isPublicRoute } from './guard.utils';

@Injectable()
export class BranchGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublicRoute(this.reflector, context)) {
      return true;
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_BRANCH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.isPlatformAdmin || user.scope === AccessScope.Platform) {
      request.resolvedBranchId =
        request.headers[BRANCH_HEADER] ??
        request.params?.branchId ??
        request.query?.branchId ??
        null;
      return true;
    }

    const headerBranchId = request.headers[BRANCH_HEADER] as string | undefined;
    const routeBranchId =
      request.params?.branchId ??
      request.query?.branchId ??
      request.body?.branchId;

    const isAgencyWide = user.dataScope === DataScope.Agency;

    if (isAgencyWide) {
      request.resolvedBranchId = headerBranchId ?? routeBranchId ?? null;
      return true;
    }

    if (!user.branchId) {
      throw new ForbiddenException('Branch assignment required');
    }

    const requestedBranch = routeBranchId ?? headerBranchId;
    if (requestedBranch && requestedBranch !== user.branchId) {
      throw new ForbiddenException('Access denied for this branch');
    }

    request.resolvedBranchId = user.branchId;
    return true;
  }
}
