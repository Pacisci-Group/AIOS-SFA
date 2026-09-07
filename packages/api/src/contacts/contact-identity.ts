import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  toDateKey,
} from '../leads/intake/intake.normalize';

/**
 * The owner's contact identity rule, as data (PAC-91 §9).
 *
 * > A contact is unique on **date of birth + full name + phone or email**.
 * > Same name, same DOB and either the same phone *or* the same email is the
 * > same person. (David, 2026-09-07.)
 *
 * Pure — no Mongoose, no Nest — so the schema can import it without a cycle and
 * the derivation can be unit-tested without a database. The query side lives in
 * `ContactIdentityService`; the index definitions are consumed by
 * `contact.schema.ts` and by the migration that builds them.
 *
 * ⚠ The rule is an **OR**, so it is two indexes rather than one, and every leg
 * is optional — on the 2026-09-04 production export 322 contacts have no DOB
 * and 611 have neither phone nor email. A row missing any leg is deliberately
 * *not* indexed and *not* considered a duplicate: without a birth date we
 * cannot prove two people with the same name are one person, and pretending
 * otherwise would merge strangers. Those cases stay with the fuzzy intake
 * scorer (`contact-match.ts`), which resolves ambiguity toward "create a new
 * contact" for exactly the same reason.
 */
export const CONTACT_IDENTITY_INDEXES: ReadonlyArray<Record<string, 1>> = [
  { agencyId: 1, nameKey: 1, dobKey: 1, phone: 1 },
  { agencyId: 1, nameKey: 1, dobKey: 1, email: 1 },
];

/** Index names Mongo derives from {@link CONTACT_IDENTITY_INDEXES}. */
export const CONTACT_IDENTITY_INDEX_NAMES = CONTACT_IDENTITY_INDEXES.map(
  (keys) =>
    Object.entries(keys)
      .map(([field, direction]) => `${field}_${direction}`)
      .join('_'),
);

/** The four fields every identity index leg is built from. */
export const CONTACT_IDENTITY_FIELDS = ['nameKey', 'dobKey', 'phone', 'email'];

/** The identity legs of one contact, all normalised. */
export interface ContactIdentity {
  nameKey: string | null;
  dobKey: string | null;
  email: string | null;
  phone: string | null;
}

/** The stored fields identity is derived from. Structural, so a lean doc fits. */
export interface ContactIdentitySource {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: Date | string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * `"<first> <last>"`, lowercased, internal whitespace collapsed.
 *
 * Lowercased in the *key* rather than left to a collation: a collation makes a
 * comparison case-insensitive but cannot be combined with the
 * `partialFilterExpression` these indexes need, and the same key has to be
 * computable by a migration and a raw-driver script that have no Mongoose
 * schema in hand.
 *
 * Null when either half is missing — half a name identifies nobody, and a key
 * built from one would collide every "Smith" in the book.
 */
export function contactNameKey(
  firstName?: string | null,
  lastName?: string | null,
): string | null {
  const first = normalizeName(firstName).toLowerCase();
  const last = normalizeName(lastName).toLowerCase();
  return first && last ? `${first} ${last}` : null;
}

/** `YYYY-MM-DD` in UTC. Null when there is no usable date. */
export function contactDobKey(value?: Date | string | null): string | null {
  return toDateKey(value ?? null);
}

/** Every identity leg of one contact, each normalised the way it is stored. */
export function contactIdentity(
  source: ContactIdentitySource,
): ContactIdentity {
  return {
    nameKey: contactNameKey(source.firstName, source.lastName),
    dobKey: contactDobKey(source.dateOfBirth),
    email: normalizeEmail(source.email),
    phone: normalizePhone(source.phone),
  };
}

/**
 * True when this contact carries a complete leg of the rule — i.e. when the
 * unique indexes can actually see it, and {@link ContactIdentityService} can
 * make a definite judgement about it.
 */
export function hasCompleteIdentity(identity: ContactIdentity): boolean {
  return Boolean(
    identity.nameKey && identity.dobKey && (identity.phone || identity.email),
  );
}

/**
 * Thrown when an update would leave `nameKey` describing a name the contact no
 * longer has.
 *
 * A stale key is worse than a missing one: the row stays in the unique index
 * under the *old* identity, so it neither blocks the duplicate it should nor
 * matches the person it now describes. No call site does this today — every
 * rename goes through `contact.save()` — and this exists so that a future one
 * fails at the write instead of silently corrupting the index.
 */
export class PartialNameUpdateError extends Error {
  constructor(field: 'firstName' | 'lastName') {
    super(
      `Contact update sets ${field} without the other half of the name; ` +
        'nameKey cannot be recomputed. Set firstName and lastName together, ' +
        'or edit through a hydrated document so the save hook can derive it.',
    );
    this.name = 'PartialNameUpdateError';
  }
}

/** A Mongoose update document, as much of it as this file needs to see. */
interface UpdateLike {
  $set?: Record<string, unknown>;
  $unset?: Record<string, unknown>;
  [key: string]: unknown;
}

/*
 * Two functions rather than one that guesses, because the two shapes overlap:
 * `{ firstName, lastName }` is a whole document to `create()` and a `$set` to
 * `updateOne()`, and nothing about the object itself says which. Every caller
 * is a schema hook that already knows.
 */

/**
 * Fill `nameKey` / `dobKey` on a document being written whole — `save()`,
 * `create()`, `insertMany()`.
 *
 * Called from the `Contact` schema's hooks so that no writer has to remember,
 * which is the whole point: one forgotten call site leaves a contact out of the
 * partial unique indexes, and the duplicate they exist to prevent is then
 * created with no error at all.
 *
 * ⚠ `Model.bulkWrite()` bypasses Mongoose middleware entirely (`AGENTS.md`
 * §11), and so does a raw-driver write. The migration and
 * `merge-duplicate-contacts.ts` therefore compute the keys with
 * {@link contactIdentity} themselves.
 */
export function stampIdentityKeys(target: unknown): void {
  if (!target || typeof target !== 'object') return;

  const doc = target as ContactIdentitySource & {
    nameKey?: string | null;
    dobKey?: string | null;
  };
  doc.nameKey = contactNameKey(doc.firstName, doc.lastName) ?? undefined;
  doc.dobKey = contactDobKey(doc.dateOfBirth) ?? undefined;
}

/**
 * Keep `nameKey` / `dobKey` in step with an **update**.
 *
 * Derives only from the fields the update itself carries — it cannot see the
 * stored document. That covers every call site: names are only ever changed
 * through a hydrated `save()`, and the intake merge sets `dateOfBirth` alone,
 * which determines `dobKey` on its own. A partial rename it *cannot* resolve
 * throws {@link PartialNameUpdateError} rather than leaving a stale key behind.
 */
export function stampIdentityKeysOnUpdate(target: unknown): void {
  if (!target || typeof target !== 'object') return;
  stampOnUpdate(target as UpdateLike);
}

function stampOnUpdate(update: UpdateLike): void {
  const set = (update.$set ??= {});
  const unset = update.$unset;
  // Mongoose treats bare top-level keys as `$set`, and callers mix the two.
  const plain = Object.fromEntries(
    Object.entries(update).filter(([key]) => !key.startsWith('$')),
  );

  const touches = (field: string): boolean =>
    field in set || field in plain || (unset ? field in unset : false);
  const incoming = (field: string): unknown =>
    unset && field in unset
      ? undefined
      : field in set
        ? set[field]
        : plain[field];

  if (touches('dateOfBirth')) {
    const key = contactDobKey(incoming('dateOfBirth') as Date | null);
    assign(update, 'dobKey', key);
  }

  const first = touches('firstName');
  const last = touches('lastName');
  if (first !== last)
    throw new PartialNameUpdateError(first ? 'firstName' : 'lastName');
  if (first && last) {
    const key = contactNameKey(
      incoming('firstName') as string | null,
      incoming('lastName') as string | null,
    );
    assign(update, 'nameKey', key);
  }
}

/** `$set` a derived key, or `$unset` it when the source no longer yields one. */
function assign(update: UpdateLike, field: string, value: string | null): void {
  if (value === null) {
    delete (update.$set as Record<string, unknown>)[field];
    update.$unset = { ...(update.$unset ?? {}), [field]: '' };
    return;
  }
  if (update.$unset) delete update.$unset[field];
  (update.$set as Record<string, unknown>)[field] = value;
}
