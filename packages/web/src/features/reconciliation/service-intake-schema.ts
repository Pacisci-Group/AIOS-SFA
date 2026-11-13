import {
  MAX_RECONCILIATION_OUTCOME_NOTE_LENGTH,
  POLICY_TYPES,
  type PolicyType,
  type ReconciliationAssignedRowDetail,
  type ReconciliationServiceIntakeInput,
} from "@sfa/shared";
import { z } from "zod";
import {
  emptyLeadIntake,
  makeLeadIntakeSchema,
  type LeadIntakeFormValues,
} from "@/features/lead/components/lead-intake-schema";
import { numericString } from "@/lib/zod-helpers";

const ymd = z
  .string()
  .trim()
  .min(1, "Enter the date")
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Not a real date");

/** The signed application, as the row's presign flow hands it back. */
const attachmentSchema = z.object({
  key: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().nonnegative(),
});

/**
 * The 1-800 service intake form (PAC-173 PR 5).
 *
 * The client half **is** the New Lead form's — its primary contact, living
 * address and members, picked out of `makeLeadIntakeSchema` so the shared field
 * groups (`PrimaryContactFields`, `AddressFields`, `MemberRowGroup`) line up
 * exactly, and so a client is captured here by the same rules as a lead: DOB,
 * phone and email on the primary. No lead date, no lead source — there is no
 * lead.
 *
 * Then the policy, from Dash and confirmed (the signed application is required,
 * a PDF, as on every policy entered), and the hand-off: whose welcome call it
 * is, and what it opens with.
 */
export function makeServiceIntakeSchema(today: string) {
  return makeLeadIntakeSchema("internal", today)
    .pick({ primaryContact: true, address: true, members: true })
    .extend({
      policy: z.object({
        policyNumber: z
          .string()
          .trim()
          .min(1, "Enter the policy number")
          .max(60, "Too long"),
        policyType: z
          .string()
          .refine(
            (value) => (POLICY_TYPES as readonly string[]).includes(value),
            "Pick the policy type",
          ),
        premium: numericString({
          required: "Enter the premium",
          min: 0,
          max: 1_000_000,
          tooSmall: "Premium must be 0 or greater",
          tooLarge: "Too large",
        }),
        itemCount: numericString({
          required: "Enter a count",
          min: 1,
          max: 99,
          tooSmall: "At least 1",
          tooLarge: "Too many",
          integer: "Whole numbers only",
        }),
        effectiveDate: ymd,
        newBusinessApplication: attachmentSchema.optional().refine(Boolean, {
          message: "Attach the new business application.",
        }),
      }),
      assignedCsrId: z.string().min(1, "Pick whose welcome call this is"),
      openingNote: z
        .string()
        .trim()
        .max(MAX_RECONCILIATION_OUTCOME_NOTE_LENGTH, "Too long"),
    });
}

export type ServiceIntakeFormValues = z.infer<
  ReturnType<typeof makeServiceIntakeSchema>
>;

/** The client half, as the household prefill produces it. */
export type ServiceIntakeClient = Pick<
  LeadIntakeFormValues,
  "primaryContact" | "address" | "members"
>;

/** The client half seeded from Dash's customer name, the rest blank. */
export function dashClient(
  row: ReconciliationAssignedRowDetail,
): ServiceIntakeClient {
  const blank = emptyLeadIntake();
  const name = row.prefill?.lead;
  return {
    primaryContact: {
      ...blank.primaryContact,
      firstName: name?.firstName ?? "",
      lastName: name?.lastName ?? "",
    },
    address: blank.address,
    members: blank.members,
  };
}

/** The whole form, seeded from the row: the Dash line, and the caller as the CSR when they are one. */
export function serviceIntakeDefaults(
  row: ReconciliationAssignedRowDetail,
  defaultCsrId: string,
): ServiceIntakeFormValues {
  const policy = row.prefill?.policy;
  return {
    ...dashClient(row),
    policy: {
      policyNumber: policy?.policyNumber ?? "",
      policyType: policy?.policyType ?? "",
      premium: policy?.premium != null ? String(policy.premium) : "",
      itemCount: String(policy?.itemCount ?? 1),
      effectiveDate: policy?.effectiveDate ?? "",
      newBusinessApplication: undefined,
    },
    assignedCsrId: defaultCsrId,
    openingNote: row.prefill?.serviceIntake?.openingNote ?? "",
  };
}

/** Form strings → the wire shape, once validation has passed. */
export function toServiceIntakeInput(
  values: ServiceIntakeFormValues,
  householdId: string | null,
): ReconciliationServiceIntakeInput {
  return {
    householdId,
    primaryContact: values.primaryContact,
    address: values.address,
    members: values.members.map(({ dateOfBirth, ...member }) => ({
      ...member,
      ...(dateOfBirth ? { dateOfBirth } : {}),
    })),
    policy: {
      policyNumber: values.policy.policyNumber.trim(),
      policyType: values.policy.policyType as PolicyType,
      premium: Number(values.policy.premium),
      itemCount: Number(values.policy.itemCount),
      effectiveDate: values.policy.effectiveDate,
      newBusinessApplication: values.policy.newBusinessApplication!,
    },
    assignedCsrId: values.assignedCsrId,
    openingNote: values.openingNote.trim() || null,
  };
}
