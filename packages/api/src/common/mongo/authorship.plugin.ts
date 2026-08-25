import {
  CallbackWithoutResultAndOptionalError,
  Document,
  Query,
  Schema,
  Types,
} from 'mongoose';
import { currentUserObjectId } from '../context/request-context';

/**
 * Query operators the plugin stamps `updatedBy` onto.
 *
 * `replaceOne` is deliberately absent: a replacement document has no `$set` to
 * merge into, so stamping it would either be dropped or corrupt the operation.
 * Nothing in this codebase replaces a tenant record wholesale.
 */
const UPDATE_OPS = ['updateOne', 'updateMany', 'findOneAndUpdate'] as const;

/** Read a nested key off an update object without asserting `any`. */
function operand(
  update: Record<string, unknown>,
  operator: string,
): Record<string, unknown> {
  const value = update[operator];
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Add `createdBy` to an upsert's **insert branch**, or return `null` when the
 * update already names an author.
 *
 * `$setOnInsert`, never `$set`: on a re-run the document already exists and its
 * original author must survive. The "already named" check is not politeness —
 * `createdBy` appearing in both `$set` and `$setOnInsert` makes MongoDB reject
 * the whole write with a path conflict.
 *
 * Extracted from the hook so the merge is testable without a live connection.
 */
export function mergeInsertAuthorship(
  update: Record<string, unknown>,
  userId: Types.ObjectId,
): Record<string, unknown> | null {
  const setOnInsert = operand(update, '$setOnInsert');
  const alreadyAuthored =
    'createdBy' in setOnInsert ||
    'createdBy' in operand(update, '$set') ||
    'createdBy' in update;
  if (alreadyAuthored) return null;

  return {
    ...update,
    $setOnInsert: { ...setOnInsert, createdBy: userId },
  };
}

/**
 * Stamps `createdBy` / `updatedBy` from the ambient request context (PAC-72).
 *
 * Registered **connection-wide** in `app.module.ts`, so every model compiled on
 * that connection gets it without opting in. Schemas that do not declare the
 * fields — anything not extending `TenantRecord` — are skipped outright rather
 * than relying on Mongoose's strict mode to silently drop the paths.
 *
 * WHAT IT COVERS
 * --------------
 * `save()` / `create()`, and the `updateOne` / `updateMany` / `findOneAndUpdate`
 * query operators (including their upsert-insert branch).
 *
 * 🔴 WHAT IT DOES NOT COVER — `bulkWrite`
 * ---------------------------------------
 * **`Model.bulkWrite()` bypasses Mongoose middleware entirely.** Its operations
 * go to the driver as-is, so nothing here runs for them. A `bulkWrite` call
 * site that should record an author must spread {@link authorshipForInsert}
 * into the document itself — `AuditGenerationService.buildItem` is the worked
 * example. The PAC-72 ticket claims a plugin "works on bulk paths too"; it does
 * not, and audit items would have been the one collection silently missing an
 * author.
 *
 * WHY AMBIENT AND NOT A PARAMETER
 * -------------------------------
 * The alternative — every write passing an actor explicitly — is honest but
 * needs ~22 collections' worth of discipline forever, and a half-populated
 * `updatedBy` is worse than none: it reads as "nobody edited this" rather than
 * as "we didn't record it". Authorship is provenance, not authorization; unlike
 * `AccessContext` nothing branches on it, so keeping it out of signatures costs
 * no reviewability.
 *
 * Writes with no request context (migration, seeds, the worker) leave both
 * fields `null`, which is read as "system". Nothing is backfilled — historical
 * rows genuinely have no known author.
 */
export function authorshipPlugin(schema: Schema): void {
  // Only `TenantRecord` descendants declare these. Skipping the rest keeps the
  // hooks off `roles`, `users`, `agencies` and `counters` entirely.
  if (!schema.path('createdBy') || !schema.path('updatedBy')) {
    return;
  }

  schema.pre('save', function (this: Document) {
    const userId = currentUserObjectId();
    if (!userId) return;

    // Never overwrite an author a caller set deliberately.
    if (this.isNew && !this.get('createdBy')) {
      this.set('createdBy', userId);
    }
    this.set('updatedBy', userId);
  });

  // Registered one at a time: Mongoose's `pre` overloads take a single op or a
  // `RegExp`, and an array of literals does not match either.
  for (const op of UPDATE_OPS) {
    schema.pre(op, function (this: Query<unknown, unknown>) {
      const userId = currentUserObjectId();
      if (!userId) return;

      const update = this.getUpdate();
      // An aggregation-pipeline update is a different language; leave it alone.
      if (update === null || Array.isArray(update)) return;

      this.set('updatedBy', userId);

      if (!this.getOptions()?.upsert) return;

      const merged = mergeInsertAuthorship(update, userId);
      if (merged) {
        this.setUpdate(merged);
      }
    });
  }

  schema.pre(
    'insertMany',
    function (
      next: CallbackWithoutResultAndOptionalError,
      docs: Array<Record<string, unknown>>,
    ) {
      const userId = currentUserObjectId();
      if (!userId || !Array.isArray(docs)) {
        next();
        return;
      }

      for (const doc of docs) {
        if (!doc || typeof doc !== 'object') continue;
        doc.createdBy ??= userId;
        doc.updatedBy ??= userId;
      }
      next();
    },
  );
}
