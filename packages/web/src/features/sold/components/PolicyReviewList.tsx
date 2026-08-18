import { CARRIER_OTHER } from "@sfa/shared";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { FormSubPanel } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SoldPolicyFormValues } from "./sold-deal-schema";

interface PolicyReviewListProps {
  policies: SoldPolicyFormValues[];
  /** Pull a policy back into the draft, in place. */
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const formatDate = (value: string) =>
  value ? new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }) : "—";

/**
 * Everything about to be booked, in full (PAC-56 #25).
 *
 * Distinct from `PolicySummaryList`, which is the running one-line-per-policy
 * tally shown *during* the loop. This is the last screen before money is
 * recorded, so it shows what the producer actually typed rather than a
 * summary — the whole point of the item is that nothing is booked unseen.
 *
 * Carrier resolves the "Other" sentinel, because `__other__` on a review page
 * would be a bug the producer cannot interpret.
 */
export function PolicyReviewList({
  policies,
  onEdit,
  onRemove,
  disabled,
}: PolicyReviewListProps) {
  return (
    <ul className="space-y-3">
      {policies.map((policy, index) => (
        <li key={index}>
          <FormSubPanel
            title={
              <span className="flex items-center gap-2">
                <Badge variant="secondary">{policy.policyType}</Badge>
                <span className="text-sm text-card-foreground">
                  {policy.policyNumber}
                </span>
              </span>
            }
            action={
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onEdit(index)}
                  aria-label={`Edit policy ${policy.policyNumber}`}
                >
                  <Pencil className="size-4" />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onRemove(index)}
                  aria-label={`Remove policy ${policy.policyNumber}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </span>
            }
          >
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              <Row label="Carrier" value={carrierName(policy)} />
              <Row label="Start date" value={formatDate(policy.effectiveDate)} />
              <Row
                label="Premium"
                value={currency.format(Number(policy.premium) || 0)}
              />
              <Row
                label="Items"
                value={String(Number(policy.itemCount) || 0)}
              />
              <Row
                label="Prior insurance"
                value={priorInsuranceSummary(policy)}
                wide
              />
              <Row label="Discounts" value={discountSummary(policy)} wide />
            </dl>

            <DocumentRow
              label="New business application"
              filename={policy.newBusinessApplication?.filename}
            />
          </FormSubPanel>
        </li>
      ))}
    </ul>
  );
}

function Row({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-card-foreground">{value}</dd>
    </div>
  );
}

function DocumentRow({
  label,
  filename,
}: {
  label: string;
  filename?: string;
}) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <FileText className="size-4 shrink-0" />
      <span className="text-card-foreground">{label}</span>
      <span className="min-w-0 truncate">{filename ?? "Not attached"}</span>
    </p>
  );
}

function carrierName(policy: SoldPolicyFormValues): string {
  return policy.carrier === CARRIER_OTHER
    ? (policy.carrierOther?.trim() ?? "—")
    : policy.carrier || "—";
}

function priorInsuranceSummary(policy: SoldPolicyFormValues): string {
  if (policy.priorInsurance.none) return "None";

  const carrier =
    policy.priorInsurance.carrier === CARRIER_OTHER
      ? policy.priorInsurance.carrierOther?.trim()
      : policy.priorInsurance.carrier;

  const parts = [carrier || "Carrier not named"];
  if (policy.priorInsurance.agentName?.trim()) {
    parts.push(policy.priorInsurance.agentName.trim());
  }
  parts.push(
    policy.cancellation.cancelled
      ? `cancelled ${formatDate(policy.cancellation.effectiveDate ?? "")}`
      : "cancellation pending",
  );
  return parts.join(" · ");
}

/**
 * The selected discounts, named as the producer selected them.
 *
 * Deliberately the **form's** labels rather than the audit-item titles they
 * resolve to ("Roof receipt", not "Hail Resistant Roof"): this page is the
 * producer checking their own answers, and renaming them here would read as a
 * different set of choices.
 */
function discountSummary(policy: SoldPolicyFormValues): string {
  const d = policy.discounts;
  const selected: string[] = [];

  if (d.priorInsuranceDiscount) selected.push("Prior insurance");
  if (d.escrow) selected.push("Escrow");
  if (d.fireSubscription.selected) selected.push("Fire subscription");
  if (d.roofReceipt.selected) selected.push("Roof receipt");
  if (d.acvPersonalProperty) selected.push("ACV — personal property");
  if (d.acvDwellingProtection) selected.push("ACV — dwelling");
  if (d.drivewise) selected.push("Drivewise");
  if (d.defensiveDriver.selected) {
    const names = d.defensiveDriver.drivers
      .map((driver) => driver.name.trim())
      .filter(Boolean);
    selected.push(
      names.length
        ? `Defensive driver (${names.join(", ")})`
        : "Defensive driver",
    );
  }
  if (d.studentDiscount.selected) selected.push("Good student");

  return selected.length ? selected.join(", ") : "None";
}
