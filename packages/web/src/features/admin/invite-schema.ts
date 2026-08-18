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
 * **No `branchId`.** The invite form deliberately does not assign a branch for
 * now; invitees land with `branchId` unset and are placed afterwards.
 * `InviteUserDto.branchId` stays optional on the API, so restoring the picker is
 * a change to this file plus `InviteUserDialog` and nothing else.
 */
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
});

export type InviteFormValues = z.infer<typeof inviteFormSchema>;

export const EMPTY_INVITE: InviteFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  roleId: "",
};

/** Form state → wire body. Lowercasing is repeated server-side; both matter. */
export function toInviteUserInput(values: InviteFormValues): InviteUserInput {
  return {
    email: values.email.trim().toLowerCase(),
    roleIds: [values.roleId],
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
  };
}
