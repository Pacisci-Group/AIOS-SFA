import { z } from "zod";
import type { InviteUserInput } from "@/lib/users-api";

/**
 * The "Invite user" form (PAC-58 Scope 3).
 *
 * **Name is required here but optional in `InviteUserDto`,** and that mismatch
 * is intentional rather than drift. The API also serves the seed and the
 * SmartSuite migration, whose legacy records often carry no split name; a person
 * an owner is typing in by hand has one, and the invite email greets them by it.
 *
 * `roleId` is a single value even though the wire contract is `roleIds[]` — one
 * role per employee was the product call, and the roles are whole personas
 * (Producer, CSR, Branch Manager) rather than composable grants. Widened to a
 * multi-select later, this is the only file that changes shape.
 *
 * `branchId` is **optional here though the picker always has a selection**: it
 * is prefilled with the agency's default branch, but the picker only renders
 * when `GET /branches` answers, and that call needs `agency:branches:read` —
 * a permission the invite itself does not require. Making it required would
 * turn a 403 on a secondary read into an unsubmittable form; instead the
 * invitee lands branchless, exactly as they did before the picker existed.
 * (Branchless is still a dead end — nothing reassigns a branch after the
 * invite yet — which is why the picker defaults to a real branch rather than
 * to "none".)
 */
/**
 * The "no policy" choice in the leave-policy picker (PAC-162). A sentinel
 * rather than `''` because Radix's `Select` refuses an empty-string item.
 */
export const NO_LEAVE_POLICY = "__none__";

export const inviteFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email")
    .max(160),
  roleId: z.string().min(1, "Pick a role"),
  branchId: z.string().optional(),
  /**
   * A leave policy to put them on from day one, or {@link NO_LEAVE_POLICY}
   * for "set up later in HR → Onboardings" (PAC-162). Optional like the
   * branch, and for the same reason: the picker only renders when `GET
   * /hr/leave-policies` answers, which needs `agency:hr:admin`.
   */
  leavePolicyId: z.string().optional(),
  /** `YYYY-MM-DD`; read only with a policy. Empty means the invite day. */
  hireDate: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a date.")
    .optional(),
});

export type InviteFormValues = z.infer<typeof inviteFormSchema>;

export const EMPTY_INVITE: InviteFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  roleId: "",
  branchId: "",
  leavePolicyId: NO_LEAVE_POLICY,
  hireDate: "",
};

/** Form state → wire body. Lowercasing is repeated server-side; both matter. */
export function toInviteUserInput(values: InviteFormValues): InviteUserInput {
  const withPolicy =
    values.leavePolicyId && values.leavePolicyId !== NO_LEAVE_POLICY;
  return {
    email: values.email.trim().toLowerCase(),
    roleIds: [values.roleId],
    // Omitted rather than sent empty: `''` fails `@IsMongoId` with a 400,
    // where absent is the documented "place them later" case.
    ...(values.branchId ? { branchId: values.branchId } : {}),
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    // Same rule for the policy and the start date: absent, never empty.
    ...(withPolicy ? { leavePolicyId: values.leavePolicyId } : {}),
    ...(withPolicy && values.hireDate ? { hireDate: values.hireDate } : {}),
  };
}
