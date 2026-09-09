import { Schema as MongooseSchema } from 'mongoose';

/**
 * The schema type to declare an ObjectId link with: `@Prop({ type: ObjectIdType })`.
 *
 * ⚠ **Never write `@Prop({ type: Types.ObjectId })`.** It compiles, it reads
 * correctly, and it silently produces a **Mixed** path — no casting, no
 * validation. A 24-hex *string* then stores verbatim as a string, and a later
 * query with a real `ObjectId` matches nothing, at neither write nor read time.
 * That is how a seeded service ticket came to hold a string `agencyId` and stay
 * invisible to every CRM queue query.
 *
 * The cause is `@nestjs/mongoose`, not Mongoose. `DefinitionsFactory`
 * (`inspectTypeDefinition`) resolves a `type` that is a function by asking
 * `isMongooseSchemaType`, which requires the constructor to extend
 * `mongoose.SchemaType`. `mongoose.Types.ObjectId` is the **bson** class and
 * extends `BSONValue`, so it fails that test, is treated as a nested `@Schema`
 * class, and — finding no schema metadata on it — is rewritten to `{}`.
 * Mongoose reads `type: {}` as an empty nested object, i.e. Mixed. A plain
 * `new Schema({ x: { type: Types.ObjectId } })` is fine, because Mongoose's own
 * resolution handles the bson class; Nest destroys the type before Mongoose
 * ever sees it. `mongoose.Schema.Types.ObjectId` is a real `SchemaType`
 * subclass, passes the test, and survives — which is all this constant is.
 *
 * `mongoose.Types.ObjectId` stays the right thing for **values** and for
 * TypeScript **types** (`producerId: Types.ObjectId`). This is only about the
 * `type:` key of a `@Prop`.
 *
 * The array form `@Prop({ type: [{ type: Types.ObjectId, ref: 'X' }] })` was
 * never affected — Nest leaves an array-valued `type` alone and Mongoose casts
 * it correctly — but it uses this constant too, so there is one rule and no
 * exception to remember.
 */
export const ObjectIdType = MongooseSchema.Types.ObjectId;
