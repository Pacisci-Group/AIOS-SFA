import {
  AGENCY_SLUG_MAX_LENGTH,
  AGENCY_SLUG_MIN_LENGTH,
  AGENCY_SLUG_PATTERN,
  DEFAULT_BRANCH_NAME,
  ModuleKey,
  ONBOARDING_DEFAULT_MODULES,
} from "@sfa/shared";
import { z } from "zod";
import type { OnboardAgencyInput } from "@/lib/platform-api";

/**
 * The Onboard Agency wizard's form state (PAC-69).
 *
 * Mirrors `onboardAgencySchema` on the API, sharing the rules that matter
 * (`AGENCY_SLUG_PATTERN`, the module defaults) through `@sfa/shared` rather than
 * restating them — a client-side rule that disagreed with the server's is how a
 * form that validates cleanly starts 400ing.
 *
 * Uniqueness is **not** in here. Whether a slug is taken is a server question,
 * answered live by `checkAgencyAvailability` and again on submit; a zod schema
 * cannot ask it, and pretending otherwise would mean a field that shows no error
 * until the very last step.
 */
export const onboardFormSchema = z.object({
  agency: z.object({
    name: z.string().trim().min(2, "Enter the agency's name").max(120),
    slug: z
      .string()
      .trim()
      .min(AGENCY_SLUG_MIN_LENGTH, "A slug needs at least two characters")
      .max(AGENCY_SLUG_MAX_LENGTH, "That slug is too long")
      .regex(
        AGENCY_SLUG_PATTERN,
        "Lowercase letters, numbers and single hyphens — e.g. acme-insurance",
      ),
    /**
     * Both mailer fields are optional, matching the API. An agency without them
     * imports no mailers and warns on every RTP upload, which the step says —
     * but an agency that will never run a mail campaign should not be blocked
     * on inventing one.
     */
    ticker: z.string().trim().max(8, "Tickers are at most 8 characters"),
    allstateAgencyId: z.string().trim().max(40),
  }),
  branch: z.object({
    name: z.string().trim().min(1, "Give the branch a name").max(80),
    address: z.object({
      street: z.string().trim().max(200),
      city: z.string().trim().max(120),
      state: z.string().trim().max(60),
      zip: z.string().trim().max(20),
    }),
  }),
  modules: z.array(z.nativeEnum(ModuleKey)),
  owner: z.object({
    firstName: z.string().trim().min(1, "First name is required").max(100),
    lastName: z.string().trim().min(1, "Last name is required").max(100),
    email: z
      .string()
      .trim()
      .min(1, "Email is required")
      .email("Enter a valid email")
      .max(160),
  }),
});

export type OnboardFormValues = z.infer<typeof onboardFormSchema>;

export const EMPTY_ONBOARD: OnboardFormValues = {
  agency: { name: "", slug: "", ticker: "", allstateAgencyId: "" },
  branch: {
    name: DEFAULT_BRANCH_NAME,
    address: { street: "", city: "", state: "", zip: "" },
  },
  modules: [...ONBOARDING_DEFAULT_MODULES],
  owner: { firstName: "", lastName: "", email: "" },
};

/**
 * Form state → wire body.
 *
 * Empty optional strings are dropped rather than sent as `""`: the API's schema
 * has them as `.optional()` with a `min(1)`, so an empty string is a validation
 * error where an absent key is the intended "not provided".
 */
export function toOnboardInput(values: OnboardFormValues): OnboardAgencyInput {
  const trimmed = (value: string) => value.trim() || undefined;
  return {
    agency: {
      name: values.agency.name.trim(),
      slug: values.agency.slug.trim().toLowerCase(),
      ticker: trimmed(values.agency.ticker),
      allstateAgencyId: trimmed(values.agency.allstateAgencyId),
    },
    branch: {
      name: values.branch.name.trim(),
      address: {
        street: trimmed(values.branch.address.street),
        city: trimmed(values.branch.address.city),
        state: trimmed(values.branch.address.state),
        zip: trimmed(values.branch.address.zip),
      },
    },
    modules: values.modules,
    owner: {
      firstName: values.owner.firstName.trim(),
      lastName: values.owner.lastName.trim(),
      email: values.owner.email.trim().toLowerCase(),
    },
  };
}

/**
 * Agency name → suggested slug.
 *
 * Hyphenated, matching `AGENCY_SLUG_PATTERN`. Only ever *suggested*: it stops
 * following the name the moment the operator edits the slug themselves, because
 * silently overwriting a deliberate choice on the next keystroke of the name is
 * infuriating in a way that is hard to even describe in a bug report.
 */
export function suggestSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, AGENCY_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}
