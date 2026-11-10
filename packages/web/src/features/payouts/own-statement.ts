import { AgencyPermission } from "@sfa/shared";
import { useAuth } from "@/contexts/auth-context";
import { usePermissions } from "@/hooks/usePermissions";

/**
 * Is this the viewer's own statement, which they may not issue? A reviewer
 * does not enter the figures on, recalculate, send or reopen their own
 * statement without `agency:payouts:admin` — what it says is their pay, so
 * someone else decides it. The API refuses the same with
 * `PAYOUT_STATEMENT_OWN_INPUTS` / `PAYOUT_STATEMENT_OWN_STATEMENT`; this only
 * keeps the buttons away.
 */
export function useOwnStatementBlocked(
  statement: { userId: string } | null | undefined,
): boolean {
  const { user } = useAuth();
  const { can } = usePermissions();
  return Boolean(
    statement &&
    statement.userId === user?.id &&
    !can(AgencyPermission.PayoutsAdmin),
  );
}
