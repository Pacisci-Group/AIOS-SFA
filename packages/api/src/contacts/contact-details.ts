import { toDateKey } from '../leads/intake/intake.normalize';

/**
 * Reading a contact's display details through a reference, in one query.
 *
 * PAC-91 §1 deleted the denormalised copies of a contact's name, email and
 * phone that `Lead` and `Household` used to carry, so every list that rendered
 * them now follows a ref (`Lead.primaryContactId`, `Household.primaryContactId`)
 * instead. That is a join, and a join done per row is how a page that ran two
 * queries starts running fifty — hence one batched loader, shared, rather than
 * a lookup inside each row mapper.
 *
 * Deliberately **not** an aggregation `$lookup`: the Leads list and the Hot
 * Leads panel are `find()` queries whose sort is index-served (and Hot Leads
 * runs two bounded passes per temperature for reasons its own docblock spells
 * out). Turning either into a pipeline to save one indexed `$in` would trade a
 * documented, index-backed design for a worse one.
 */

/** An ObjectId, a lean `_id`, or an already-serialized id string. */
type IdLike = { toString(): string };

/** What a reference to a contact renders as. */
export interface ContactDetails {
  name: string | null;
  email: string | null;
  phone: string | null;
  /**
   * `YYYY-MM-DD` when this person has died, else null (PAC-91 §7).
   *
   * Carried alongside the name rather than instead of it: the name is what
   * identifies the household on every list and drawer and must keep rendering,
   * while the email and phone beside it must stop being offered as a way to
   * reach anybody. A list row has no roster to look this up in, which is why it
   * travels with the details.
   */
  deceasedAt: string | null;
}

export const NO_CONTACT_DETAILS: ContactDetails = {
  name: null,
  email: null,
  phone: null,
  deceasedAt: null,
};

/** The contact fields this reads. Structural, so a lean doc satisfies it. */
export interface ContactDetailSource {
  _id: IdLike;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  deceasedAt?: Date | string | null;
}

/** `null` when there is no name to show, so a caller's `??` chain continues. */
export function contactDisplayName(
  contact: Pick<ContactDetailSource, 'firstName' | 'lastName'> | null,
): string | null {
  if (!contact) return null;
  return (
    [contact.firstName, contact.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' ') || null
  );
}

export function toContactDetails(
  contact: ContactDetailSource | null,
): ContactDetails {
  if (!contact) return NO_CONTACT_DETAILS;
  return {
    name: contactDisplayName(contact),
    email: contact.email?.trim() || null,
    phone: contact.phone?.trim() || null,
    deceasedAt: toDateKey(contact.deceasedAt),
  };
}

/** The `find` surface this needs — a `Model<ContactDocument>` satisfies it. */
export interface ContactFinder {
  find(filter: Record<string, unknown>): {
    select(fields: string): {
      lean(): Promise<ContactDetailSource[]>;
    };
  };
}

/**
 * Load several contacts' display details in one query, keyed by contact id.
 *
 * Ids absent from the result — a dangling ref, or a contact outside the extra
 * filter — are simply missing from the map, so a caller's `?? null` renders a
 * blank rather than throwing. That is the same outcome the empty denormalised
 * copy used to produce, so no reader gets *worse* than it was.
 */
export async function loadContactDetails(
  contacts: ContactFinder,
  ids: ReadonlyArray<IdLike | null | undefined>,
  extraFilter: Record<string, unknown> = {},
): Promise<Map<string, ContactDetails>> {
  const unique = [...new Set(ids.filter(Boolean).map((id) => String(id)))];
  const out = new Map<string, ContactDetails>();
  if (!unique.length) return out;

  const found = await contacts
    .find({ ...extraFilter, _id: { $in: unique } })
    .select('firstName lastName email phone deceasedAt')
    .lean();

  for (const contact of found) {
    out.set(String(contact._id), toContactDetails(contact));
  }
  return out;
}
