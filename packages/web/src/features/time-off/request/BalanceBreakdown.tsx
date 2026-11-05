import type { TimeOffBalanceLines, TimeOffProjectionView } from "@sfa/shared";
import { formatDay } from "@/features/hr/policies/policy-display";
import { formatBalance } from "@/features/hr/policies/time-off/time-off-display";
import { cn } from "@/lib/utils";

/**
 * The balance lines of a request (PAC-165) — Gusto's four, shown the same
 * way in the form and in the review window:
 *
 * Current balance · Other requested hours · This request · Remaining
 * available balance.
 *
 * A fifth line appears only when it says something the four do not: an
 * accrual or the policy's reset falls before the last leave day, so the
 * balance the request is actually judged against is the **projected** one.
 * On an Unlimited policy there is no balance and nothing is rendered.
 */
export function BalanceBreakdown({
  balance,
  projection,
  className,
}: {
  balance: TimeOffBalanceLines | null;
  projection: TimeOffProjectionView | null;
  className?: string;
}) {
  if (!balance) return null;
  const projected = projection?.crossesAccrual ? projection : null;
  // With a projection, the projection is what decides; without one, line four.
  const short = projected ? projected.lowestBalance < 0 : balance.remainingHours < 0;

  return (
    <dl
      className={cn(
        "grid gap-2 rounded-lg border border-border bg-sunken px-4 py-3 text-sm",
        className,
      )}
    >
      <Line label="Current balance" value={formatBalance(balance.currentBalance)} />
      <Line label="Other requested hours" value={taken(balance.otherRequestedHours)} />
      <Line label="This request" value={taken(balance.thisRequestHours)} />
      <div className="border-t border-border pt-2">
        <Line
          label="Remaining available balance"
          value={formatBalance(balance.remainingHours)}
          strong
          attention={!projected && short}
        />
      </div>
      {projected && (
        <div className="border-t border-border pt-2">
          <Line
            label="Lowest projected balance"
            value={formatBalance(projected.lowestBalance)}
            strong
            attention={short}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {projected.lowestOn ? `On ${formatDay(projected.lowestOn)}, ` : ""}
            counting the hours earned and reset before then. This is the number the request is
            checked against.
          </p>
        </div>
      )}
    </dl>
  );
}

/** Hours coming off the balance: `− 24 h`, and a plain `0 h` for none. */
function taken(hours: number): string {
  return hours > 0 ? `− ${formatBalance(hours)}` : formatBalance(hours);
}

function Line({
  label,
  value,
  strong,
  attention,
}: {
  label: string;
  value: string;
  strong?: boolean;
  attention?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          strong ? "font-semibold" : "text-foreground",
          attention ? "text-destructive" : strong && "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
