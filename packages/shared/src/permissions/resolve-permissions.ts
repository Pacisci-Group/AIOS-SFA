export interface PermissionOverrides {
  grants: string[];
  revokes: string[];
}

/**
 * Ensure every `{module}:write` permission also carries `{module}:read`.
 * Write always implies read in the simplified page model.
 */
function expandWriteImpliesRead(set: Set<string>): void {
  for (const permission of [...set]) {
    if (permission.endsWith(':write')) {
      const moduleKey = permission.slice(0, -':write'.length);
      if (moduleKey) {
        set.add(`${moduleKey}:read`);
      }
    }
  }
}

export function resolvePermissionSet(input: {
  rolePermissions: string[];
  grants?: string[];
  revokes?: string[];
  enabledModules?: string[];
  grantsAllEnabledModules?: boolean;
}): string[] {
  const set = new Set(input.rolePermissions);

  if (input.grantsAllEnabledModules && input.enabledModules?.length) {
    for (const module of input.enabledModules) {
      set.add(`${module}:read`);
      set.add(`${module}:write`);
    }
  }

  for (const grant of input.grants ?? []) {
    set.add(grant);
  }

  for (const revoke of input.revokes ?? []) {
    set.delete(revoke);
  }

  // Apply write => read AFTER grants/revokes so the invariant holds no matter
  // how the set was built: any surviving `{m}:write` re-adds `{m}:read`. Read
  // can never be stripped while write remains — write always carries read.
  expandWriteImpliesRead(set);

  const result = [...set];

  if (!input.enabledModules?.length) {
    return result;
  }

  const enabled = new Set(input.enabledModules);
  return result.filter((permission) => {
    if (permission.startsWith('platform:') || permission.startsWith('agency:')) {
      return true;
    }
    const [module] = permission.split(':');
    return module ? enabled.has(module) : true;
  });
}
