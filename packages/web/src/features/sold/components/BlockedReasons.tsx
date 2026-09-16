import type { CardIssue } from "./sold-deal-schema";

/** How many reasons to spell out before collapsing the rest into a count. */
const MAX_LISTED_REASONS = 4;

interface BlockedReasonsProps {
  issues: CardIssue[];
  title?: string;
}

/**
 * Why the button below is greyed out.
 *
 * Load-bearing, not decoration. Disabling the only way forward without saying
 * why is the trap this replaces: the old button was always enabled and clicking
 * it was what marked fields touched, so the reasons appeared *because* you
 * pressed it. Nothing marks them touched now, so an untouched card would grey
 * the button and show nothing at all.
 *
 * Muted rather than destructive: nothing has gone *wrong* on a card the
 * producer has not filled in yet, and painting a blank Financials card red on
 * arrival would be scolding them for not having typed yet. The per-field
 * messages still turn red on blur, which is where the failure actually is.
 */
export function BlockedReasons({
  issues,
  title = "Still needed before you can continue",
}: BlockedReasonsProps) {
  if (issues.length === 0) return null;
  const listed = issues.slice(0, MAX_LISTED_REASONS);
  const hidden = issues.length - listed.length;

  return (
    <div
      // Polite, not assertive: it updates on every keystroke as the producer
      // works through the card, and an assertive region would interrupt them
      // each time.
      aria-live="polite"
      className="rounded-md border border-border bg-sunken px-3 py-2"
    >
      <p className="text-xs font-medium text-foreground">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {listed.map((issue) => (
          <li key={issue.path} className="text-xs text-muted-foreground">
            {issue.message}
          </li>
        ))}
        {hidden > 0 && (
          <li className="text-xs text-muted-foreground">
            …and {hidden} more
          </li>
        )}
      </ul>
    </div>
  );
}
