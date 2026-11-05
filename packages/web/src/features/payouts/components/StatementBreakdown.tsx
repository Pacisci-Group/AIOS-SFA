import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import type { PayStatementView } from "@sfa/shared";
import {
  DataRow,
  DetailCard,
  SectionLabel,
} from "@/components/common/DetailCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, formatPercent } from "@/lib/money";
import { formatMonth } from "@/lib/months";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";
import {
  chargebackSourceLabel,
  complianceLabel,
  deduction,
  formatDay,
  POOL_LABELS,
  premiumLineLabel,
  RATE_SOURCE_LABELS,
  SOM_LABELS,
  statementReference,
} from "../payout-format";

/**
 * A commission statement in the app (PAC-178): the sections of the
 * Commission Statement PDF (PAC-181 renders the same data) — details,
 * performance indicators, carrier production, the commission summary and
 * the chargeback detail — plus how each bonus was reached, which the PDF has
 * no room for.
 */
export function StatementBreakdown({
  statement,
}: {
  statement: PayStatementView;
}) {
  const s = statement;
  return (
    <div className="space-y-6">
      {s.warnings.length > 0 && (
        <Alert>
          <TriangleAlert
            aria-hidden
            className="text-amber-600! dark:text-amber-500!"
          />
          <AlertTitle>
            {s.warnings.length === 1
              ? "One thing to check"
              : `${s.warnings.length} things to check`}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {s.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <DetailCard title="Statement details">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <DataRow label="Name" value={s.userName} />
            <DataRow label="Commission period" value={formatMonth(s.month)} />
            <DataRow
              label="Producer ID"
              value={s.allstateBindId ?? NOT_AVAILABLE}
            />
            <DataRow
              label="Statement ID"
              value={statementReference(s.id, s.version)}
            />
            <DataRow
              label="Generated"
              value={new Date(s.computedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: s.timeZone,
              })}
            />
            <DataRow label="Structure" value={s.structureName} />
          </div>
        </DetailCard>

        <DetailCard title="Performance indicators">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <DataRow
              label="Tier"
              value={
                s.indicators.tier
                  ? `Tier ${s.indicators.tier.level} · ${formatMoney(s.indicators.tier.thresholdPremium)}`
                  : "None reached"
              }
            />
            <DataRow
              label="Bundle rate"
              value={
                s.indicators.bundleRate === null
                  ? NOT_AVAILABLE
                  : formatPercent(s.indicators.bundleRate)
              }
            />
            <DataRow
              label="Hat tricks"
              value={
                s.indicators.hatTricks === null
                  ? NOT_AVAILABLE
                  : String(s.indicators.hatTricks)
              }
            />
            <DataRow
              label="SOM status"
              value={SOM_LABELS[s.indicators.somStatus]}
            />
            <DataRow
              label="Compliance"
              value={
                <span
                  className={cn(
                    s.indicators.complianceStatus === "non_compliant" &&
                      "text-amber-700 dark:text-amber-500",
                  )}
                >
                  {complianceLabel(
                    s.indicators.complianceStatus,
                    s.indicators.failedAudits,
                  )}
                </span>
              }
            />
            <DataRow label="Team pool" value={POOL_LABELS[s.pool]} />
          </div>
        </DetailCard>
      </div>

      <DetailCard title="Carrier production" bodyless>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Carrier</TableHead>
              <TableHead className="text-right">Sold premium</TableHead>
              <TableHead className="text-right">Chargebacks</TableHead>
              <TableHead className="text-right">Net premium</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Bundle rate</TableHead>
              <TableHead className="pr-5 text-right">Net commission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.premiumLines.map((line) => (
              <TableRow key={`${line.carrier}|${line.leadSourceId ?? ""}`}>
                <TableCell className="pl-5">
                  <div className="font-medium">{premiumLineLabel(line)}</div>
                  <div className="text-xs text-muted-foreground">
                    {RATE_SOURCE_LABELS[line.rateSource]}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(line.grossPremium)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(deduction(line.chargebacks))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(line.netPremium)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPercent(line.ratePercent)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <div className="flex items-center justify-end gap-1.5">
                    {line.bundleShortfall && (
                      <Badge
                        variant="ghost"
                        size="sm"
                        className="bg-amber-500/15 text-amber-700 dark:text-amber-500"
                      >
                        Below {formatPercent(line.minBundleRatePercent ?? 0)}
                      </Badge>
                    )}
                    <span>
                      {line.bundleRate === null
                        ? NOT_AVAILABLE
                        : formatPercent(line.bundleRate)}
                    </span>
                  </div>
                </TableCell>
                <TableCell
                  className={cn(
                    "pr-5 text-right font-medium tabular-nums",
                    line.netCommission < 0 &&
                      "text-amber-700 dark:text-amber-500",
                  )}
                >
                  {formatMoney(line.netCommission)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-5 font-semibold">Total</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatMoney(s.totals.grossPremium)}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatMoney(deduction(s.totals.chargebackTotal))}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatMoney(s.totals.netPremium)}
              </TableCell>
              <TableCell colSpan={2} />
              <TableCell className="pr-5 text-right font-semibold tabular-nums">
                {formatMoney(
                  s.totals.grossCommission - s.totals.chargebackImpact,
                )}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </DetailCard>

      <DetailCard title="Commission summary">
        <div className="grid gap-x-10 gap-y-2 md:grid-cols-2">
          <dl className="space-y-2">
            <SummaryLine
              label="Gross carrier commission"
              amount={s.totals.grossCommission}
            />
            <SummaryLine label="Tier bonus" amount={s.totals.tierBonus} />
            <SummaryLine label="Team bonus" amount={s.totals.teamBonus} />
            <SummaryLine
              label="Salesperson of the Month bonus"
              amount={s.totals.somBonus}
            />
            <SummaryLine
              label="Hat trick bonus"
              amount={s.totals.hatTrickBonus}
            />
          </dl>
          <dl className="space-y-2">
            <SummaryLine
              label="Other bonuses / SPIFFs"
              amount={s.totals.spiffs}
            />
            <SummaryLine
              label="Compliance adjustment"
              amount={s.totals.complianceAdjustment}
            />
            <SummaryLine
              label="Chargeback commission impact"
              amount={deduction(s.totals.chargebackImpact)}
            />
            <SummaryLine
              label="Other adjustments"
              amount={s.totals.otherAdjustments}
            />
          </dl>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary px-4 py-3 text-primary-foreground">
          <span className="text-sm font-semibold tracking-wide uppercase">
            Net commission
          </span>
          <span className="text-2xl font-bold tabular-nums">
            {formatMoney(s.totals.netCommission)}
          </span>
        </div>
      </DetailCard>

      <DetailCard title="Chargeback detail" bodyless>
        {s.chargebacks.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Nothing was charged back in {formatMonth(s.month)}.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Customer</TableHead>
                <TableHead>Policy number</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Policy type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Premium</TableHead>
                <TableHead className="pr-5 text-right">
                  Commission deduction
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.chargebacks.map((row) => (
                <TableRow
                  key={row.chargebackId}
                  className={cn(row.excluded && "text-muted-foreground")}
                >
                  <TableCell
                    className={cn("pl-5", row.excluded && "line-through")}
                  >
                    {row.customerName ?? NOT_AVAILABLE}
                    {row.excluded && row.excludedNote && (
                      <div className="text-xs no-underline">
                        Left out: {row.excludedNote}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.policyNumber ?? NOT_AVAILABLE}
                  </TableCell>
                  <TableCell>{row.carrier}</TableCell>
                  <TableCell>{row.policyType ?? NOT_AVAILABLE}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatDay(row.occurredDay)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" size="sm">
                      {chargebackSourceLabel(row)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(row.amount)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "pr-5 text-right tabular-nums",
                      row.excluded && "line-through",
                    )}
                  >
                    {formatMoney(deduction(row.commissionDeduction))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="pl-5 font-semibold" colSpan={7}>
                  Total chargeback impact
                </TableCell>
                <TableCell className="pr-5 text-right font-semibold tabular-nums">
                  {formatMoney(deduction(s.totals.chargebackImpact))}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </DetailCard>

      <DetailCard title="How the bonuses were reached">
        <div className="grid gap-4 md:grid-cols-2">
          <BonusNote title="Hat trick" amount={s.bonuses.hatTrick.amount}>
            {!s.bonuses.hatTrick.enabled
              ? "This structure has no hat trick."
              : s.bonuses.hatTrick.days.length === 0
                ? `No day with ${s.bonuses.hatTrick.dealsPerDay} or more sales.`
                : `${s.bonuses.hatTrick.dealsPerDay}+ sales on ${s.bonuses.hatTrick.days
                    .map(formatDay)
                    .join(
                      ", ",
                    )}, at ${formatMoney(s.bonuses.hatTrick.bonusAmount)} each.`}
          </BonusNote>
          <BonusNote title="Monthly tier" amount={s.bonuses.individual.amount}>
            {s.bonuses.individual.reached.length === 0
              ? `${formatMoney(s.totals.grossPremium)} sold reached no tier.`
              : `${formatMoney(s.totals.grossPremium)} sold reached ${s.bonuses.individual.reached
                  .map(
                    (tier) =>
                      `${formatMoney(tier.thresholdPremium)} (${formatMoney(tier.bonusAmount)})`,
                  )
                  .join(
                    " + ",
                  )}${s.bonuses.individual.stackable ? ", stacking" : ""}.`}
          </BonusNote>
          <BonusNote title="Team bonus" amount={s.bonuses.team.amount}>
            {!s.bonuses.team.eligible
              ? "This structure does not share the team bonus."
              : !s.bonuses.team.met
                ? "The agency did not reach the first team bonus level."
                : `A share of the ${POOL_LABELS[s.bonuses.team.pool].toLowerCase()} pool (${formatMoney(
                    s.bonuses.team.groupPool,
                  )} of ${formatMoney(s.bonuses.team.poolAmount)}), by ${formatMoney(
                    s.totals.grossPremium,
                  )} of the group's ${formatMoney(s.bonuses.team.groupPremium)} sold.`}
          </BonusNote>
          <BonusNote
            title="Salesperson of the Month"
            amount={s.bonuses.salespersonOfMonth.amount}
          >
            {!s.bonuses.salespersonOfMonth.enabled
              ? "Salesperson of the Month is off."
              : s.bonuses.salespersonOfMonth.winner
                ? "The month's top seller."
                : "Someone else sold more this month."}
          </BonusNote>
        </div>
      </DetailCard>
    </div>
  );
}

function SummaryLine({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-sm font-medium tabular-nums",
          amount < 0 && "text-amber-700 dark:text-amber-500",
        )}
      >
        {formatMoney(amount)}
      </dd>
    </div>
  );
}

function BonusNote({
  title,
  amount,
  children,
}: {
  title: string;
  amount: number;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel>{title}</SectionLabel>
        <span className="text-sm font-semibold tabular-nums">
          {formatMoney(amount)}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
