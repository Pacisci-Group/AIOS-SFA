import type { PolicyCheckMatch } from "@sfa/shared";
import { AlertTriangle, Link2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DuplicatePolicyNoticeProps {
  match: PolicyCheckMatch;
  /** Already linked to this match — the producer confirmed it. */
  linked: boolean;
  onLink: () => void;
  onCorrect: () => void;
}

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/**
 * Card 3's duplicate warning.
 *
 * An inline amber panel rather than a toast, matching `LeadIntakeForm`'s error
 * convention: this needs a decision, and a toast that disappears is the wrong
 * shape for one.
 *
 * The two actions are the whole product decision from the ticket — "prompt user
 * to select and edit existing policy to prevent duplicates". Either the number
 * was mistyped (correct it) or this really is the same policy (link it, and the
 * submission updates that row instead of inserting a second).
 */
export function DuplicatePolicyNotice({
  match,
  linked,
  onLink,
  onCorrect,
}: DuplicatePolicyNoticeProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
        <div className="space-y-1 min-w-0">
          <p className="text-sm text-foreground">
            {linked
              ? "Linked to the existing policy."
              : "This policy number already exists."}
          </p>
          <p className="text-xs text-muted-foreground">
            {match.policyType} · {match.carrier}
            {match.effectiveDate && (
              <> · effective {dateFormat.format(new Date(match.effectiveDate))}</>
            )}
            {/*
              * `clientName` is withheld when the match sits outside the
              * producer's data scope — they still need to know the number is
              * taken, but not whose client it is.
              */}
            {match.clientName ? (
              <> · {match.clientName}</>
            ) : (
              <> · another producer&rsquo;s client</>
            )}
          </p>
        </div>
      </div>

      {!linked && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCorrect}>
            <Pencil size={14} />
            Correct the number
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onLink}>
            <Link2 size={14} />
            Yes, this is the same policy
          </Button>
        </div>
      )}
    </div>
  );
}
