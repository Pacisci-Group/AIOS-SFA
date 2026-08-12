import type { HouseholdView } from "@sfa/shared";
import { HOUSEHOLD_MEMBER_ROLES } from "@sfa/shared";
import {
  emptyLeadIntake,
  type LeadIntakeFormValues,
} from "@/features/lead/components/lead-intake-schema";

/** `roleInHousehold` is free-ish text on the record; the form's is an enum. */
function toMemberRole(
  role: string | null,
): (typeof HOUSEHOLD_MEMBER_ROLES)[number] {
  const match = HOUSEHOLD_MEMBER_ROLES.find(
    (known) => known.toLowerCase() === (role ?? "").trim().toLowerCase(),
  );
  // "Driver" is the honest fallback for a member whose stored role is something
  // the intake vocabulary has no word for (or nothing at all): it is the one
  // option that claims no relationship. Guessing "Spouse" would put a
  // relationship on the record that nobody stated.
  return match ?? "Driver";
}

/** Read one address part off the household's loosely-typed stored address. */
function addressPart(
  address: Record<string, unknown> | null,
  key: string,
): string {
  const value = address?.[key];
  return typeof value === "string" ? value : "";
}

/** ISO timestamp or date → the `YYYY-MM-DD` the form's date inputs want. */
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  // Sliced, never `new Date(iso).toISOString()`: a stored UTC-midnight birthday
  // re-rendered through a local timezone shows the day before for anyone west
  // of Greenwich. Same rule as `formatDate` in `lead-display.ts`.
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return match ? match[1] : "";
}

/**
 * Seed the New Lead form from the household already on screen — the "create a
 * lead" half of the Household page's Start Quote dialog.
 *
 * A second lead for an existing client is the *normal* case here (a cross-sell,
 * a re-quote at renewal), and every field below is already on the record. Making
 * the producer re-type a birthday they can see two columns to the left is how
 * the typo that splits the household into two gets made.
 *
 * What is deliberately **not** prefilled: the lead source. It describes where
 * *this* enquiry came from, which is the one thing the household record cannot
 * know, and it is the form's only required field with no defensible default.
 *
 * The household is pinned server-side by `householdId`, so nothing typed here
 * can move the lead onto a different household — these values only decide what
 * the lead and its contacts *say*, never where they land.
 */
export function leadIntakeFromHousehold(
  household: HouseholdView,
): LeadIntakeFormValues {
  const blank = emptyLeadIntake();
  const primary =
    household.contacts.find((contact) => contact.isPrimary) ??
    household.contacts[0];

  const [fallbackFirst = "", ...fallbackRest] = (
    household.primaryContactName ?? ""
  ).split(" ");

  return {
    ...blank,
    primaryContact: {
      firstName: primary?.firstName ?? fallbackFirst,
      lastName: primary?.lastName ?? fallbackRest.join(" "),
      dateOfBirth: toDateInput(primary?.dateOfBirth ?? null),
      // The contact's own details first, falling back to the household-level
      // ones the migration wrote — a migrated household often carries the phone
      // and email while its contact rows do not.
      phone: primary?.phones[0] ?? household.primaryPhones[0] ?? "",
      email: primary?.emails[0] ?? household.primaryEmails[0] ?? "",
    },
    address: {
      street: addressPart(household.propertyAddress, "street"),
      city: addressPart(household.propertyAddress, "city"),
      // Keep the form's own default when the household has no state on file,
      // rather than replacing a valid answer with an empty required field.
      state:
        addressPart(household.propertyAddress, "state") || blank.address.state,
      zip: addressPart(household.propertyAddress, "zip"),
    },
    members: household.contacts
      .filter((contact) => contact.id !== primary?.id)
      // A member row needs both names to validate. A half-named contact would
      // seed a row that is invalid the moment it appears, blocking a form the
      // producer never asked to fill in — they can add the member by hand.
      .filter((contact) => contact.firstName?.trim() && contact.lastName?.trim())
      // The schema caps members at 10.
      .slice(0, 10)
      .map((contact) => ({
        firstName: contact.firstName!,
        lastName: contact.lastName!,
        dateOfBirth: toDateInput(contact.dateOfBirth),
        role: toMemberRole(contact.roleInHousehold),
      })),
  };
}
