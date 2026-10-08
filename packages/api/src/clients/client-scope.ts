/**
 * Moved to `common/access/client-scope.ts` so the Data Export worker can apply
 * the same clamp (the worker may import `common/`, never a feature directory).
 * Re-exported here so existing callers are untouched.
 */
export * from '../common/access/client-scope';
