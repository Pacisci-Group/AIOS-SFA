/**
 * Field-path helpers for the paginated forms.
 *
 * Both the Sold wizard and the New Lead form describe a page as a list of path
 * **roots** and ask "is anything under these roots failing?". Both had their own
 * copy of {@link ownsPath}; the answer has to be identical in both, so it is
 * written once here.
 */

/**
 * Does `path` sit at or under one of `roots`?
 *
 * A root matches itself exactly, or followed by `.` / `[`. It deliberately does
 * **not** match on a bare string prefix: `"carrier"` must not own
 * `"carrierOther"`, or a blank "Other" box would sail past the gate with no
 * message anywhere on screen.
 */
export function ownsPath(roots: readonly string[], path: string): boolean {
  return roots.some(
    (root) =>
      path === root ||
      path.startsWith(`${root}.`) ||
      path.startsWith(`${root}[`),
  );
}

/**
 * A zod issue path, rendered as the string TanStack Form names the field.
 *
 * Mirrors form-core's own `prefixSchemaToErrors`: object keys join with `.`,
 * but a segment indexing an **array** becomes `[n]`, so a driver row is
 * `discounts.defensiveDriver.drivers[0].attachment` — the name the field is
 * actually registered under. Walking `value` alongside the path is what
 * distinguishes the two cases; a numeric key on a plain object stays a `.` key.
 */
export function issuePath(
  segments: readonly PropertyKey[],
  value: unknown,
): string {
  let current: unknown = value;
  let path = "";

  segments.forEach((rawSegment, index) => {
    // Standard Schema allows a path segment to be `{ key }` rather than the key
    // itself; form-core unwraps it, so we do too.
    const segment =
      typeof rawSegment === "object" && rawSegment !== null
        ? (rawSegment as { key: PropertyKey }).key
        : rawSegment;

    const asNumber = Number(segment);
    if (Array.isArray(current) && !Number.isNaN(asNumber)) {
      path += `[${asNumber}]`;
    } else {
      path += (index > 0 ? "." : "") + String(segment);
    }

    current =
      typeof current === "object" && current !== null
        ? (current as Record<PropertyKey, unknown>)[segment]
        : undefined;
  });

  return path;
}
