import type { LeadDetailPriorInsurance } from "@sfa/shared";
import { formatDate } from "./lead-display";

interface PriorInsuranceCardProps {
  priorInsurance: LeadDetailPriorInsurance;
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-card-foreground">{value}</p>
    </div>
  );
}

/**
 * Block B — the coverage the client is leaving, as captured by the Sold form
 * (PAC-40).
 *
 * The page renders this **only when a deal exists**, so there is no empty state
 * here: an unsold lead shows no card at all rather than a shell of dashes.
 *
 * Deliberately narrower than the mockup, which additionally shows a policy
 * number, liability limits, deductibles, a current premium and a
 * continuous-coverage figure. None of those exist on `priorInsurance` or
 * `priorPolicies` — the Sold form never asks for them and the migration never
 * carried them — so they are omitted rather than fabricated. This is a data gap
 * to close in the Sold form, not an unfinished port.
 */
export function PriorInsuranceCard({ priorInsurance }: PriorInsuranceCardProps) {
  const cells = [
    { label: "Auto carrier", value: priorInsurance.previousCarrierAuto },
    { label: "Home carrier", value: priorInsurance.previousCarrierHome },
    { label: "Previous agent", value: priorInsurance.previousAgentName },
    {
      label: "Same carrier (auto + home)",
      value: priorInsurance.autoHomeSameCarrier,
    },
    { label: "Cancelled", value: priorInsurance.cancelledPreviousInsurance },
    {
      label: "Cancellation handled by",
      value: priorInsurance.cancellationResponsibility,
    },
  ].filter((cell): cell is { label: string; value: string } =>
    Boolean(cell.value),
  );

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Prior Insurance
        </h2>
        {priorInsurance.cancellationDate && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">
            Cancels {formatDate(priorInsurance.cancellationDate)}
          </span>
        )}
      </div>

      {cells.length > 0 && (
        <div className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {cells.map((cell) => (
            <Cell key={cell.label} label={cell.label} value={cell.value} />
          ))}
        </div>
      )}

      {priorInsurance.policies.length > 0 && (
        <div className="border-t border-border px-5 py-4">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Policies being replaced
          </p>
          <ul className="mt-2 space-y-2">
            {priorInsurance.policies.map((policy) => (
              <li
                key={policy.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="text-card-foreground">
                  {policy.policyType ?? "Policy"}
                  {policy.previousCarrier && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {policy.previousCarrier}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[
                    policy.cancellationStatus,
                    policy.cancellationDate
                      ? formatDate(policy.cancellationDate)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cells.length === 0 && priorInsurance.policies.length === 0 && (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          A prior-insurance record exists but carries no details.
        </p>
      )}
    </section>
  );
}
