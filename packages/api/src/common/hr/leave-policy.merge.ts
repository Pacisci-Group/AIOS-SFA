import type { DeepPartial, LeavePolicyRules } from '@sfa/shared';

/**
 * Template + overrides → the rules one employee is judged under (PAC-161).
 *
 * `overrides` is the shape PAC-162 stores on the employee profile: only the
 * fields that differ from the template. The merge is **by path, with arrays
 * replaced whole** — an override of `leaveTypes` is the full list, never an
 * element patch, because there is no stable way to address "the second leave
 * type" once the template's list changes under it.
 *
 * `overriddenPaths` is what the profile page shows as "Custom" and what a
 * snapshot records: the dotted paths that came from the override, not the
 * template.
 */
export interface MergedRules {
  rules: LeavePolicyRules;
  overriddenPaths: string[];
}

/**
 * By tag, not by prototype: a `structuredClone` result (or a Mongo `.lean()`
 * row under Jest's vm realm) has an `Object.prototype` from another realm, so
 * `getPrototypeOf(value) === Object.prototype` is false for exactly the
 * objects this merges.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function mergeInto(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  prefix: string,
  paths: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    // A path the template does not have is not a rule; ignore it rather than
    // let a stale override from an older shape leak into the engines.
    if (!Object.prototype.hasOwnProperty.call(base, key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const current = base[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = mergeInto(current, value, path, paths);
    } else {
      out[key] = value;
      paths.push(path);
    }
  }
  return out;
}

export function mergeRules(
  template: LeavePolicyRules,
  overrides: DeepPartial<LeavePolicyRules> | null | undefined,
): MergedRules {
  if (!overrides || Object.keys(overrides).length === 0) {
    return { rules: structuredClone(template), overriddenPaths: [] };
  }
  const paths: string[] = [];
  const rules = mergeInto(
    structuredClone(template) as unknown as Record<string, unknown>,
    overrides,
    '',
    paths,
  ) as unknown as LeavePolicyRules;
  return { rules, overriddenPaths: paths };
}
