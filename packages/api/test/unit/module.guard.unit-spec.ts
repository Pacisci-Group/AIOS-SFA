import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_ANY_MODULE_KEY,
  REQUIRE_MODULE_KEY,
} from '../../src/common/decorators/access.decorators';
import { ModuleGuard } from '../../src/common/guards/module.guard';

describe('ModuleGuard — @RequireAnyModule', () => {
  const agency = {
    modules: {
      clients: { enabled: false },
      crm_service: { enabled: true },
    },
  };

  function buildContext(): ExecutionContext {
    const request = {
      access: { agencyId: 'agency-1', isPlatformAdmin: false },
    };
    return {
      getHandler: () => 'handler',
      getClass: () => 'class',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function buildGuard(metadata: Record<string, unknown>) {
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;
    const agencyModel = {
      findById: () => ({ lean: () => Promise.resolve(agency) }),
    } as never;
    return new ModuleGuard(reflector, agencyModel);
  }

  it('passes when at least one listed module is enabled', async () => {
    const guard = buildGuard({
      [REQUIRE_ANY_MODULE_KEY]: ['clients', 'crm_service'],
    });
    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });

  it('rejects when every listed module is disabled', async () => {
    const guard = buildGuard({
      [REQUIRE_ANY_MODULE_KEY]: ['clients', 'leads'],
    });
    await expect(guard.canActivate(buildContext())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('still requires every module in the AND-set', async () => {
    const guard = buildGuard({
      [REQUIRE_MODULE_KEY]: ['clients'],
    });
    await expect(guard.canActivate(buildContext())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('passes when no module metadata is declared', async () => {
    const guard = buildGuard({});
    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });
});
