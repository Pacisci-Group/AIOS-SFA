import { AlertCircle, Trophy, TriangleAlert } from "lucide-react";
import type { PayoutRunView } from "@sfa/shared";
import { KpiCard } from "@/components/common/KpiCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatMoney } from "@/lib/money";
import { formatMonth } from "@/lib/months";
import { NOT_AVAILABLE } from "@/lib/not-available";

/**
 * The month at a glance (PAC-178): the agency's premium against the team
 * bonus, the two pools, the statements by status and what they pay. Counts
 * and the pay total are over the statements the reader may see; the premium
 * and the pools are the agency's, because the team bonus is. December's run
 * also names the Producer of the Year (2026 comp plans).
 */
export function RunSummary({
  run,
  partial,
}: {
  run: PayoutRunView;
  /** The month is still running. */
  partial: boolean;
}) {
  const team = run.teamBonus;
  const firstLevel = team.levels[0];
  const winners = run.salespersonOfMonth.winners;
  const counts = run.counts;
  const poy = run.producerOfYear;

  return (
    <div className="space-y-4">
      {run.status === "failed" && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>The last calculation did not finish</AlertTitle>
          <AlertDescription>
            {run.error ?? "Something went wrong."} The figures below are from
            before it.
          </AlertDescription>
        </Alert>
      )}
      {run.warnings.length > 0 && (
        <Alert>
          <TriangleAlert
            aria-hidden
            className="text-amber-600! dark:text-amber-500!"
          />
          <AlertTitle>
            {run.warnings.length === 1
              ? "One thing to check"
              : `${run.warnings.length} things to check`}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {run.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Agency premium"
          value={formatMoney(run.agencyGrossPremium)}
          caption={
            !team.enabled
              ? `${formatMonth(run.month)}${partial ? ", so far" : ""} · team bonus off`
              : team.met
                ? `Team bonus reached (first level ${formatMoney(firstLevel?.thresholdPremium ?? 0)})`
                : `First team level ${formatMoney(firstLevel?.thresholdPremium ?? 0)} not reached`
          }
          isPending={false}
        />
        <KpiCard
          label="Team pool"
          value={formatMoney(team.poolAmount)}
          caption={`CSRs ${formatMoney(team.csrPool)} · Producers ${formatMoney(team.producerPool)}`}
          isPending={false}
        />
        <KpiCard
          label="Statements"
          value={String(counts.statements)}
          caption={`${counts.draft} draft · ${counts.sent} sent · ${counts.accepted} accepted · ${counts.rejected} disputed`}
          isPending={false}
        />
        <KpiCard
          label="Net pay"
          value={formatMoney(run.totals.netPay ?? run.totals.netCommission)}
          caption={
            <>
              {run.totals.netPay !== undefined &&
              run.totals.netPay !== run.totals.netCommission
                ? `Net commission ${formatMoney(run.totals.netCommission)} · `
                : ""}
              {!run.salespersonOfMonth.enabled
                ? `On ${formatMoney(run.totals.grossPremium)} sold`
                : winners.length
                  ? `Salesperson of the Month: ${winners.map((winner) => winner.name).join(", ")}`
                  : "No Salesperson of the Month"}
            </>
          }
          isPending={false}
        />
      </div>

      {poy && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-5 py-3 text-sm">
          <Trophy aria-hidden className="size-4 shrink-0 text-primary" />
          <span className="font-semibold text-foreground">
            Producer of the Year {run.month.slice(0, 4)}
          </span>
          <span className="text-muted-foreground">
            {!poy.enabled
              ? "Off this year."
              : poy.winners.length
                ? `${poy.winners.map((winner) => winner.name || NOT_AVAILABLE).join(", ")} · ${formatMoney(poy.bonusAmount)} bonus${poy.topGrossPremium !== null ? ` · ${formatMoney(poy.topGrossPremium)} sold this year` : ""}`
                : "No producer was compliant in enough months."}
          </span>
        </div>
      )}
    </div>
  );
}
