import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessScope, DataScope } from '@sfa/shared';
import { BRANCH_HEADER } from '../constants/permissions.constants';
import { SKIP_BRANCH_KEY } from '../decorators/access.decorators';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { asIdString, isPublicRoute } from './guard.utils';

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

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const access = request.access;
    if (!access) {
      throw new ForbiddenException('Authentication required');
    }

    if (access.isPlatformAdmin || access.scope === AccessScope.Platform) {
      request.resolvedBranchId =
        asIdString(request.headers[BRANCH_HEADER]) ??
        asIdString(request.params?.branchId) ??
        asIdString(request.query?.branchId) ??
        null;
      return true;
    }

    const headerBranchId = asIdString(request.headers[BRANCH_HEADER]);
    const routeBranchId: unknown =
      request.params?.branchId ??
      request.query?.branchId ??
      request.body?.branchId;

    const isAgencyWide = access.dataScope === DataScope.Agency;

    if (isAgencyWide) {
      request.resolvedBranchId =
        headerBranchId ?? asIdString(routeBranchId) ?? null;
      return true;
    }

    if (!access.branchId) {
      throw new ForbiddenException('Branch assignment required');
    }

    const requestedBranch = routeBranchId ?? headerBranchId;
    if (requestedBranch && requestedBranch !== access.branchId) {
      throw new ForbiddenException('Access denied for this branch');
    }

    request.resolvedBranchId = access.branchId;
    return true;
  }
}
