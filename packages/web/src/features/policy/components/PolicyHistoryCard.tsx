import { useQuery } from "@tanstack/react-query";
import { ArrowDown, History, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { PolicyReplacementChainEntry } from "@sfa/shared";
import { POLICY_REPLACEMENT_REASON_LABELS } from "@sfa/shared";
import { DetailCard } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { getPolicyHistory } from "@/lib/policies-api";
import { cn } from "@/lib/utils";

const money = (value: number) =>
  `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function shortDate(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The replacement chain a policy belongs to, oldest first.
 *
 * **Renders nothing for a policy that has never been replaced.** A chain of one
 * is every ordinary policy in the book, and a "History" card saying "this policy
 * replaced nothing" on all of them is noise that teaches people to skip the
 * card — which is exactly when it starts mattering.
 *
 * Shown from any link in the chain and always shows the whole thing, because
 * that is what the endpoint returns: someone opening the original policy from
 * two rewrites ago is asking the same question as someone opening the current
 * one. The entry they opened is marked rather than being made the start.
 */
export function PolicyHistoryCard({ policyId }: { policyId: string }) {
  const query = useQuery({
    queryKey: ["policy-history", policyId],
    queryFn: () => getPolicyHistory(policyId),
    enabled: Boolean(policyId),
  });

  // A failed history fetch stays silent. It is supporting context on a page
  // whose own data loaded fine, and an error card here would read as though the
  // policy itself were broken.
  if (query.isError) return null;

  if (query.isPending) {
    return (
      <DetailCard title="Policy history" icon={History}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Loading history…
        </p>
      </DetailCard>
    );
  }

  const entries = query.data?.entries ?? [];
  if (entries.length < 2) return null;

  return (
    <DetailCard title="Policy history" icon={History}>
      <ol className="space-y-1">
        {entries.map((entry, index) => (
          <li key={entry.policyId}>
            <ChainRow entry={entry} />
            {index < entries.length - 1 && (
              <div className="flex items-center gap-2 py-1 pl-3 text-xs text-muted-foreground">
                <ArrowDown aria-hidden className="size-3.5 shrink-0" />
                <span>
                  {entry.reason
                    ? POLICY_REPLACEMENT_REASON_LABELS[entry.reason]
                    : "Replaced"}
                  {entry.chargebackAmount !== null &&
                    entry.chargebackAmount > 0 && (
                      <>
                        {" · "}
                        <span className="text-destructive">
                          {money(entry.chargebackAmount)} charged back
                        </span>
                        {entry.withinClawbackWindow
                          ? " (within a month — credit reversed)"
                          : " (credit kept)"}
                      </>
                    )}
                </span>
              </div>
            )}
          </li>
        ))}
      </ol>

      {query.data && query.data.totalChargeback > 0 && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          Total charged back across this chain:{" "}
          <span className="font-semibold text-destructive tabular-nums">
            {money(query.data.totalChargeback)}
          </span>
        </p>
      )}
    </DetailCard>
  );
}

function ChainRow({ entry }: { entry: PolicyReplacementChainEntry }) {
  const label = entry.policyNumber ?? "No policy number";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-sm",
        // The policy the reader came from, so a three-link chain does not make
        // them hunt for where they are.
        entry.isRequested ? "bg-sunken font-medium" : "text-muted-foreground",
      )}
    >
      {entry.isRequested ? (
        <span>{label}</span>
      ) : (
        <Link
          to={`/policies/${entry.policyId}`}
          className="underline-offset-2 hover:underline"
        >
          {label}
        </Link>
      )}

      <span className="text-xs text-muted-foreground">
        {entry.policyType ?? "—"}
        {entry.carrier ? ` · ${entry.carrier}` : ""}
      </span>

      <span className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {shortDate(entry.effectiveDate)}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            entry.active ? "text-success" : "text-muted-foreground",
          )}
        >
          {entry.status || (entry.active ? "Active" : "Inactive")}
        </Badge>
      </span>
    </div>
  );
}
