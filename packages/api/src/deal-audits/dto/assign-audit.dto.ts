import { AUDIT_OWNER_TYPES } from '@sfa/shared';
import { z } from 'zod';

/**
 * A user or a role, by ObjectId.
 *
 * 🔴 `id` is validated as an ObjectId string even for a role, because a role is
 * identified by its `_id` and never by its slug. Accepting a slug here would
 * put a string into a field the access filter matches as an ObjectId — which
 * matches nothing, silently, and hides the audit from everyone.
 */
const ownerSchema = z.object({
  type: z.enum(AUDIT_OWNER_TYPES),
  id: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{24}$/i, 'Expected an id.'),
});

/**
 * `PATCH /deal-audits/deals/:dealId/assignment`.
 *
 * Both fields are optional but the object must not be empty — the two controls
 * fire independently, so this is a patch rather than a replace. `null` clears
 * the slot, which is distinct from omitting it: an audit whose reviewer left
 * the agency has to be un-assignable, not just re-assignable.
 */
export const assignAuditSchema = z
  .object({
    assignee: ownerSchema.nullable().optional(),
    reviewer: ownerSchema.nullable().optional(),
  })
  .refine(
    (value) => value.assignee !== undefined || value.reviewer !== undefined,
    { message: 'Provide an assignee or a reviewer.' },
  );

export type AssignAuditDto = z.infer<typeof assignAuditSchema>;
export type AuditOwnerInput = z.infer<typeof ownerSchema>;
