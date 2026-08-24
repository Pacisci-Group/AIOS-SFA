import { Schema, Types } from 'mongoose';
import { authorshipPlugin, mergeInsertAuthorship } from './authorship.plugin';

const USER = new Types.ObjectId('507f1f77bcf86cd799439011');
const OTHER = new Types.ObjectId('507f191e810c19729de860ea');

/** A schema shaped like a `TenantRecord` descendant. */
function authoredSchema(): Schema {
  return new Schema({
    name: String,
    createdBy: { type: Schema.Types.ObjectId, default: null },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  });
}

describe('authorshipPlugin', () => {
  describe('opt-in by declared path', () => {
    it('registers hooks on a schema carrying both fields', () => {
      const schema = authoredSchema();
      const pre = jest.spyOn(schema, 'pre');

      authorshipPlugin(schema);

      expect(pre).toHaveBeenCalled();
    });

    it('skips a schema that declares neither', () => {
      // The plugin is registered connection-wide, so it also meets `roles`,
      // `users`, `agencies` and `counters`. Those must be left completely
      // alone rather than relying on strict mode to drop the paths.
      const schema = new Schema({ name: String });
      const pre = jest.spyOn(schema, 'pre');

      authorshipPlugin(schema);

      expect(pre).not.toHaveBeenCalled();
    });

    it('skips a schema declaring only one of the pair', () => {
      const schema = new Schema({
        createdBy: { type: Schema.Types.ObjectId },
      });
      const pre = jest.spyOn(schema, 'pre');

      authorshipPlugin(schema);

      expect(pre).not.toHaveBeenCalled();
    });
  });

  /*
   * The upsert branch, which is where this can actually corrupt a write:
   * `createdBy` in both `$set` and `$setOnInsert` is not a silent overwrite,
   * it is a MongoServerError that fails the whole operation.
   */
  describe('mergeInsertAuthorship', () => {
    it('adds createdBy to the insert branch only', () => {
      const merged = mergeInsertAuthorship({ $set: { name: 'x' } }, USER);

      expect(merged).toEqual({
        $set: { name: 'x' },
        $setOnInsert: { createdBy: USER },
      });
    });

    it('preserves an existing $setOnInsert payload', () => {
      const merged = mergeInsertAuthorship(
        { $setOnInsert: { name: 'x', dealId: 7 } },
        USER,
      );

      expect(merged).toEqual({
        $setOnInsert: { name: 'x', dealId: 7, createdBy: USER },
      });
    });

    it('leaves an explicit author in $setOnInsert alone', () => {
      // A caller that named an author meant it — `AuditGenerationService`
      // passes one through `authorshipForInsert` for the bulkWrite path.
      const merged = mergeInsertAuthorship(
        { $setOnInsert: { createdBy: OTHER } },
        USER,
      );

      expect(merged).toBeNull();
    });

    it('backs off when $set already names createdBy', () => {
      // Adding it to $setOnInsert here is the path-conflict error.
      const merged = mergeInsertAuthorship(
        { $set: { createdBy: OTHER } },
        USER,
      );

      expect(merged).toBeNull();
    });

    it('backs off on a bare replacement-style update naming createdBy', () => {
      const merged = mergeInsertAuthorship({ createdBy: OTHER }, USER);

      expect(merged).toBeNull();
    });

    it('does not mutate the caller-supplied update', () => {
      const update = { $set: { name: 'x' } };

      mergeInsertAuthorship(update, USER);

      expect(update).toEqual({ $set: { name: 'x' } });
    });
  });
});
