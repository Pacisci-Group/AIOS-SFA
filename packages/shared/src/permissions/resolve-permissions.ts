export interface PermissionOverrides {
  grants: string[];
  revokes: string[];
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
