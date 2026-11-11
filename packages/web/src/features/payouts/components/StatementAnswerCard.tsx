import { CircleCheck, Info, MessageSquareWarning } from "lucide-react";
import type { PayStatementView } from "@sfa/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useIsOwnStatement, useOwnStatementBlocked } from "../own-statement";
import { formatInstantDay } from "../payout-format";

/**
 * Where the employee's answer stands (PAC-182), above every tab of the
 * statement page, for everyone who may open it:
 *
 * - **Disputed** — when, and the employee's notes. The employee is told it
 *   may still change; whoever corrects it is told to send it again.
 * - **Accepted** — when, and the name it was signed with.
 * - **Sent**, to its own employee — a prompt to answer it.
 *
 * Nothing for a draft, or for a reviewer looking at a sent one.
 */
export function StatementAnswerCard({
  statement: s,
  reviewer,
}: {
  statement: PayStatementView;
  reviewer: boolean;
}) {
  const own = useIsOwnStatement(s);
  const ownBlocked = useOwnStatementBlocked(s);
  // Who corrects a disputed statement: a reviewer, on their own only with
  // `agency:payouts:admin` (as the page's Send again).
  const corrects = reviewer && !ownBlocked;

  if (s.status === "rejected" && s.rejection) {
    return (
      <Alert>
        <MessageSquareWarning
          aria-hidden
          className="text-amber-700! dark:text-amber-500!"
        />
        <AlertTitle className="line-clamp-none text-amber-700 dark:text-amber-500">
          Disputed {formatInstantDay(s.rejection.rejectedAt, s.timeZone)}
        </AlertTitle>
        <AlertDescription>
          <p className="text-foreground whitespace-pre-wrap">
            {s.rejection.notes}
          </p>
          {corrects ? (
            <p>Correct it, then send it again.</p>
          ) : own ? (
            <p>
              Your manager is correcting it. It may change until it is sent to
              you again.
            </p>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  if (s.status === "accepted" && s.acceptance) {
    return (
      <Alert>
        <CircleCheck aria-hidden className="text-success!" />
        <AlertTitle className="line-clamp-none">
          Accepted {formatInstantDay(s.acceptance.acceptedAt, s.timeZone)} ·
          signed as {s.acceptance.typedName}
        </AlertTitle>
      </Alert>
    );
  }

  if (s.status === "sent" && own) {
    return (
      <Alert>
        <Info aria-hidden className="text-primary!" />
        <AlertTitle className="line-clamp-none">
          Review it, then accept or dispute it.
        </AlertTitle>
        <AlertDescription>
          Accepting signs it and is final. Disputing sends it back, with your
          notes, to be corrected.
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
