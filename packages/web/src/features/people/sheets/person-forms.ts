import {
  EARLIEST_DATE_OF_BIRTH,
  PHONE_MAX_LENGTH,
  type PersonProfileView,
  type UpdatePersonFactsInput,
} from "@sfa/shared";
import { z } from "zod";

/**
 * The two HR forms on a person's profile (PAC-162): Edit details and the
 * Details step of Complete onboarding. Dates are `YYYY-MM-DD` strings
 * (what `<input type="date">` holds), bounded against **today on the
 * agency's calendar** — the same day the API judges them on — so the
 * schemas are built per render with that day.
 */

const name = z.string().trim().max(60, "Keep it under 60 characters");
const phone = z
  .string()
  .trim()
  .max(PHONE_MAX_LENGTH, `Keep it under ${PHONE_MAX_LENGTH} characters`);

/** A date input's value: blank, or a day. */
const day = z.string().trim();

function notAfter(today: string, message: string) {
  return (value: string) => value === "" || value <= today
    ? true
    : message;
}

function dateOfBirthRule(today: string) {
  return (value: string, ctx: z.RefinementCtx) => {
    if (value === "") return;
    if (value >= today) {
      ctx.addIssue({ code: "custom", message: "A date of birth must be in the past." });
    } else if (value < EARLIEST_DATE_OF_BIRTH) {
      ctx.addIssue({ code: "custom", message: "That is before 1900." });
    }
  };
}

export function detailsFormSchema(today: string) {
  return z.object({
    firstName: name,
    lastName: name,
    phone,
    hireDate: day.refine(
      (value) => notAfter(today, "")(value) === true,
      "A hire date cannot be in the future.",
    ),
    dateOfBirth: day.superRefine(dateOfBirthRule(today)),
    showBirthday: z.boolean(),
  });
}
export type DetailsFormValues = z.infer<ReturnType<typeof detailsFormSchema>>;

export function detailsFromProfile(profile: PersonProfileView): DetailsFormValues {
  return {
    firstName: profile.user.firstName ?? "",
    lastName: profile.user.lastName ?? "",
    phone: profile.user.phone ?? "",
    hireDate: profile.employment.hireDate ?? "",
    dateOfBirth: profile.employment.dateOfBirth ?? "",
    showBirthday: profile.employment.showBirthday ?? true,
  };
}

/**
 * Only what changed, as the API's `clearable` PATCH wants it: an emptied
 * input is `null` (clear), an untouched field is absent (leave alone).
 */
export function toFactsInput(
  values: DetailsFormValues,
  original: DetailsFormValues,
): UpdatePersonFactsInput {
  const input: UpdatePersonFactsInput = {};
  const text = (key: "firstName" | "lastName" | "phone" | "hireDate" | "dateOfBirth") => {
    const next = values[key].trim();
    if (next !== original[key].trim()) input[key] = next || null;
  };
  text("firstName");
  text("lastName");
  text("phone");
  text("hireDate");
  text("dateOfBirth");
  if (values.showBirthday !== original.showBirthday) {
    input.showBirthday = values.showBirthday;
  }
  return input;
}

/** The Details step of Complete onboarding: the hire date is required here. */
export function onboardingFormSchema(today: string) {
  return z.object({
    hireDate: day
      .min(1, "When did they start?")
      .refine(
        (value) => notAfter(today, "")(value) === true,
        "A hire date cannot be in the future.",
      ),
    dateOfBirth: day.superRefine(dateOfBirthRule(today)),
    showBirthday: z.boolean(),
    phone,
  });
}
export type OnboardingFormValues = z.infer<ReturnType<typeof onboardingFormSchema>>;
