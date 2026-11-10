import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import {
  ANY_CARRIER,
  rateRuleCarrierLabel,
  statementNetPay,
  type PayStatementView,
} from "@sfa/shared";
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
 *
 * The 2026 comp-plan lines (base pay, stipend, rate steps, overrides, the
 * agency premium bonus, Producer of the Year, referrals, the compliance
 * floor) show only when the statement has them: one computed before they
 * existed has none of those fields, and its net pay is its net commission.
 */
export function StatementBreakdown({
  statement,
  figures,
}: {
  statement: PayStatementView;
  /**
   * The entered-figures and bonuses-and-adjustments cards, shown under the
   * warnings they answer.
   */
  figures?: ReactNode;
}) {
  const s = statement;
  const t = s.totals;
  // Commission is the rate on net premium (10 Nov 2026). A statement
  // calculated before carries `chargebackImpact` — commission on sold premium
  // with the chargebacks' commission deducted separately — and is shown that
  // way, so its stored figures still add up.
  const legacyImpact = t.chargebackImpact;
  const b = s.bonuses;
  const belowFloor = b.compliance?.belowFloor ?? false;
  const fixedPay = (t.basePay ?? 0) + (t.stipend ?? 0);
  const referral = t.referralAdjustment ?? 0;
  const floorPercent = b.compliance?.floor?.minimumPercent;
  const stepped = s.structure.rules.some((rule) => rule.steps?.length);
  const steppedLines = s.premiumLines.filter(
    (line) => line.rateStep !== null && line.rateStep !== undefined,
  );
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

      {figures}

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
                    belowFloor,
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
                  {line.rateStep !== null && line.rateStep !== undefined && (
                    <span className="text-muted-foreground">
                      {" "}
                      · step {line.rateStep}
                    </span>
                  )}
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
                {formatMoney(s.totals.grossCommission - (legacyImpact ?? 0))}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </DetailCard>

      <DetailCard title="Commission summary">
        <div className="grid gap-x-10 gap-y-2 md:grid-cols-2">
          <dl className="space-y-2">
            <SummaryLine
              label={
                legacyImpact === undefined
                  ? "Carrier commission"
                  : "Gross carrier commission"
              }
              amount={t.grossCommission}
            />
            <OptionalLine label="Rate step bonus" amount={t.rateStepBonus} />
            <OptionalLine
              label="Override commission"
              amount={t.overrideCommission}
            />
            <SummaryLine label="Tier bonus" amount={t.tierBonus} />
            <OptionalLine label="Agency premium bonus" amount={t.agencyBonus} />
            <SummaryLine label="Team bonus" amount={t.teamBonus} />
            <SummaryLine
              label="Salesperson of the Month bonus"
              amount={t.somBonus}
            />
            <SummaryLine label="Hat trick bonus" amount={t.hatTrickBonus} />
            <OptionalLine
              label="Producer of the Year bonus"
              amount={t.producerOfYearBonus}
            />
          </dl>
          <dl className="space-y-2">
            {/* Its own line whenever the statement carries it, even at $0
                (6 Nov), as on the PDF. */}
            {t.basePay !== undefined && (
              <SummaryLine label="Base pay" amount={t.basePay} />
            )}
            <OptionalLine label="Stipend" amount={t.stipend} />
            <SummaryLine label="Other bonuses / SPIFFs" amount={t.spiffs} />
            <OptionalLine
              label={referral < 0 ? "Referral deduction" : "Referral bonus"}
              amount={referral}
            />
            <SummaryLine
              label="Compliance adjustment"
              amount={t.complianceAdjustment}
            />
            <OptionalLine
              label={
                floorPercent === undefined
                  ? "Compliance reduction"
                  : `Compliance reduction (below ${formatPercent(floorPercent)})`
              }
              amount={t.complianceReduction}
            />
            {/* Only a statement calculated before 10 Nov 2026: its
                commission was on sold premium, this deducted separately. */}
            {legacyImpact !== undefined && (
              <SummaryLine
                label="Chargeback commission impact"
                amount={deduction(legacyImpact)}
              />
            )}
            <SummaryLine
              label="Other adjustments"
              amount={t.otherAdjustments}
            />
          </dl>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary px-4 py-3 text-primary-foreground">
          <div>
            <span className="text-sm font-semibold tracking-wide uppercase">
              Net pay
            </span>
            {fixedPay !== 0 && (
              <p className="text-xs text-primary-foreground/80 tabular-nums">
                Net commission {formatMoney(t.netCommission)} +{" "}
                {[
                  t.basePay ? `base pay ${formatMoney(t.basePay)}` : null,
                  t.stipend ? `stipend ${formatMoney(t.stipend)}` : null,
                ]
                  .filter(Boolean)
                  .join(" + ")}
              </p>
            )}
          </div>
          <span className="text-2xl font-bold tabular-nums">
            {formatMoney(statementNetPay(t))}
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
                <TableHead
                  className={cn(
                    "text-right",
                    legacyImpact === undefined && "pr-5",
                  )}
                >
                  Premium
                </TableHead>
                {legacyImpact !== undefined && (
                  <TableHead className="pr-5 text-right">
                    Commission deduction
                  </TableHead>
                )}
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
                  {legacyImpact === undefined ? (
                    // What comes off the line's premium; struck through when
                    // left out, since then it does not.
                    <TableCell
                      className={cn(
                        "pr-5 text-right tabular-nums",
                        row.excluded && "line-through",
                      )}
                    >
                      {formatMoney(deduction(row.amount))}
                    </TableCell>
                  ) : (
                    <>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.amount)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "pr-5 text-right tabular-nums",
                          row.excluded && "line-through",
                        )}
                      >
                        {formatMoney(deduction(row.commissionDeduction ?? 0))}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="pl-5 font-semibold" colSpan={6}>
                  {legacyImpact === undefined
                    ? "Total charged back"
                    : "Total chargeback impact"}
                </TableCell>
                {legacyImpact !== undefined && <TableCell />}
                <TableCell className="pr-5 text-right font-semibold tabular-nums">
                  {formatMoney(
                    deduction(
                      legacyImpact === undefined
                        ? s.totals.chargebackTotal
                        : legacyImpact,
                    ),
                  )}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </DetailCard>

      <DetailCard title="How the bonuses were reached">
        <div className="grid gap-4 md:grid-cols-2">
          {stepped && (
            <BonusNote title="Rate steps" amount={t.rateStepBonus ?? 0}>
              {belowFloor
                ? "Below the compliance floor, so every rate is paid at its base."
                : steppedLines.length === 0
                  ? "No step reached, so the base rates were paid."
                  : `${steppedLines
                      .map(
                        (line) =>
                          `${premiumLineLabel(line)} at step ${line.rateStep} (${formatPercent(line.ratePercent)} on all its premium)`,
                      )
                      .join(", ")}.${(b.rateSteps ?? [])
                      .map(
                        (step) =>
                          ` ${step.carrier}, step ${step.step}: a ${formatMoney(step.bonusAmount)} bonus.`,
                      )
                      .join("")}`}
            </BonusNote>
          )}
          {(b.overrides?.length ?? 0) > 0 && (
            <BonusNote title="Overrides" amount={t.overrideCommission ?? 0}>
              {`${(b.overrides ?? [])
                .map(
                  (row) =>
                    `${formatPercent(row.ratePercent)} of ${formatMoney(row.premium)} ${
                      row.basis === "agency"
                        ? "agency premium"
                        : `others sold from ${row.leadSourceName ?? NOT_AVAILABLE} leads`
                    }${carrierPhrase(row.carrier)} (${formatMoney(row.amount)})`,
                )
                .join("; ")}.`}
            </BonusNote>
          )}
          {b.agency && (
            <BonusNote title="Agency premium bonus" amount={b.agency.amount}>
              {`The agency sold ${formatMoney(b.agency.premium)}${carrierPhrase(b.agency.carrier)}, `}
              {b.agency.reached
                ? `reaching the ${formatMoney(b.agency.reached.thresholdPremium)} tier.`
                : "short of the first tier."}
            </BonusNote>
          )}
          <BonusNote title="Hat trick" amount={b.hatTrick.amount}>
            {!b.hatTrick.enabled
              ? "This structure has no hat trick."
              : b.hatTrick.days.length === 0
                ? `No day with ${b.hatTrick.dealsPerDay} or more sales.`
                : `${b.hatTrick.dealsPerDay}+ sales on ${b.hatTrick.days
                    .map(formatDay)
                    .join(
                      ", ",
                    )}, at ${formatMoney(b.hatTrick.bonusAmount)} each.${belowFloor ? " Not paid below the compliance floor." : ""}`}
          </BonusNote>
          <BonusNote title="Monthly tier" amount={b.individual.amount}>
            {belowFloor
              ? `${formatMoney(t.grossPremium)} sold. Tiers are not paid below the compliance floor.`
              : b.individual.reached.length === 0
                ? `${formatMoney(t.grossPremium)} sold reached no tier.`
                : `${formatMoney(t.grossPremium)} sold reached ${b.individual.reached
                    .map(
                      (tier) =>
                        `${formatMoney(tier.thresholdPremium)} (${formatMoney(tier.bonusAmount)})`,
                    )
                    .join(
                      " + ",
                    )}${b.individual.stackable ? ", stacking" : ""}.`}
          </BonusNote>
          <BonusNote title="Team bonus" amount={b.team.amount}>
            {!b.team.eligible
              ? "This structure does not share the team bonus."
              : !b.team.met
                ? "The agency did not reach the first team bonus level."
                : b.teamBlocked?.length
                  ? `No share of the ${POOL_LABELS[b.team.pool].toLowerCase()} pool: ${b.teamBlocked.join(" ")}`
                  : `A share of the ${POOL_LABELS[b.team.pool].toLowerCase()} pool (${formatMoney(
                      b.team.groupPool,
                    )} of ${formatMoney(b.team.poolAmount)}), by ${formatMoney(
                      t.grossPremium,
                    )} of the group's ${formatMoney(b.team.groupPremium)} sold.`}
          </BonusNote>
          <BonusNote
            title="Salesperson of the Month"
            amount={b.salespersonOfMonth.amount}
          >
            {!b.salespersonOfMonth.enabled
              ? "Salesperson of the Month is off."
              : b.salespersonOfMonth.winner
                ? "The month's top seller."
                : belowFloor
                  ? "Not paid below the compliance floor."
                  : "Someone else sold more this month."}
          </BonusNote>
          {b.producerOfYear?.enabled && (
            <BonusNote
              title="Producer of the Year"
              amount={b.producerOfYear.amount}
            >
              {b.producerOfYear.winner
                ? "The year's top producer who kept up their compliance."
                : "Not this year's winner."}
            </BonusNote>
          )}
          {b.referrals && (
            <BonusNote title="Life referrals" amount={b.referrals.amount}>
              {b.referrals.count === null
                ? `Not entered yet. The minimum is ${b.referrals.minimum}.`
                : `${b.referrals.count} valid ${b.referrals.count === 1 ? "referral" : "referrals"}: ${
                    b.referrals.amount < 0
                      ? `below the minimum of ${b.referrals.minimum}.`
                      : b.referrals.amount > 0
                        ? `${b.referrals.bonusThreshold} or more earns the bonus.`
                        : `at least the minimum of ${b.referrals.minimum}.`
                  }`}
            </BonusNote>
          )}
          {b.compliance?.floor && (
            <BonusNote title="Compliance floor" amount={b.compliance.reduction}>
              {b.compliance.percent === null
                ? `The compliance rate is not entered. The floor is ${formatPercent(b.compliance.floor.minimumPercent)}.`
                : b.compliance.belowFloor
                  ? `${formatPercent(b.compliance.percent)} is below the ${formatPercent(b.compliance.floor.minimumPercent)} floor: no Salesperson of the Month, hat trick, team or tier bonuses, every rate at its base, and ${formatPercent(b.compliance.floor.reductionPercent)} off variable pay.`
                  : `${formatPercent(b.compliance.percent)} meets the ${formatPercent(b.compliance.floor.minimumPercent)} floor.`}
            </BonusNote>
          )}
        </div>
      </DetailCard>
    </div>
  );
}

/** " on Allstate", or "" for every carrier — the API labels `*` "Any other carrier". */
function carrierPhrase(carrier: string): string {
  return carrier === rateRuleCarrierLabel(ANY_CARRIER) ||
    carrier === ANY_CARRIER
    ? ""
    : ` on ${carrier}`;
}

/** A comp-plan line: shown only when the statement has it and it is not zero. */
function OptionalLine({
  label,
  amount,
}: {
  label: string;
  amount: number | undefined;
}) {
  if (!amount) return null;
  return <SummaryLine label={label} amount={amount} />;
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
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            amount < 0 && "text-amber-700 dark:text-amber-500",
          )}
        >
          {formatMoney(amount)}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
