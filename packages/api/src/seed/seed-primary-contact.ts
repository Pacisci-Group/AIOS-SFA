import { Model, Types } from 'mongoose';
import type { Contact } from '../contacts/schemas/contact.schema';
import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from '../leads/intake/intake.normalize';

/**
 * Give a fixture household a real primary **contact** (PAC-91 §4).
 *
 * The scenario seeds used to write `primaryContactName` / `primaryEmails` /
 * `primaryPhones` straight onto the household. Those fields are gone: the name,
 * email and phone are read through `Household.primaryContactId`, so a fixture
 * that skipped creating the contact would render an em dash on every screen it
 * exists to exercise — which is exactly the migrated-data bug these fixtures
 * are supposed to help *see*.
 *
 * Keyed on `<householdKey>:primary` in `legacySmartSuiteId`, the same handle
 * the fixtures use for their households, so re-running a seed updates the
 * contact it made last time instead of adding another.
 *
 * `isTestRecord: true` — fixture people are excluded from the identity check
 * (`ContactIdentityService`) for the same reason they are excluded from intake
 * matching: several fixtures deliberately share a name, and one must never
 * block another.
 */
export async function seedPrimaryContact(
  contactModel: Model<Contact>,
  household: {
    _id: Types.ObjectId;
    agencyId: string;
    branchId?: string | null;
  },
  key: string,
  person: { name: string; email?: string; phone?: string },
): Promise<Types.ObjectId> {
  const [firstName = '', ...rest] = normalizeName(person.name).split(' ');

  const contact = await contactModel.findOneAndUpdate(
    { agencyId: household.agencyId, legacySmartSuiteId: `${key}:primary` },
    {
      $set: {
        agencyId: household.agencyId,
        branchId: household.branchId ?? null,
        legacySmartSuiteId: `${key}:primary`,
        firstName,
        lastName: rest.join(' '),
        // Normalised on the way in, like every other writer — the identity
        // indexes and contact matching both compare normalised values.
        email: normalizeEmail(person.email) ?? undefined,
        phone: normalizePhone(person.phone) ?? undefined,
        roleInHousehold: 'Named Insured',
        isPrimary: true,
        householdId: household._id,
        isTestRecord: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return contact._id;
}
