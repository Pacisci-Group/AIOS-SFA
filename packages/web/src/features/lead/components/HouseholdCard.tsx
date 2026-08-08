import type { LeadDetailHousehold } from "@sfa/shared";
import { Check, Copy, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, initials } from "./lead-display";
import { PolicyRow } from "./PolicyRow";

interface HouseholdCardProps {
  household: LeadDetailHousehold | null;
}

/**
 * The household roster and its policies (PAC-38, reworked for PAC-56 #7 + #26).
 *
 * ## What David asked for
 *
 * Two things, from the 2026-08-03 and 2026-08-04 scrum reviews:
 *
 * 1. **The household's unique identifier, visible** — a support/lookup
 *    affordance, so it is in the header with a copy button rather than buried.
 *    The chip shows the short reference (`HH-4F2A9C`); copying puts the **full
 *    id** on the clipboard, because that is what actually resolves back to the
 *    record. See `record-reference.ts` for why the two differ.
 * 2. **Policy number, policy type and carrier on each policy.** The card
 *    previously showed type and carrier run together in a sentence, and no
 *    number at all. Status is ours, not his — flag it if he reviews this.
 *
 * ## Policies are household-level, not per-member
 *
 * The mockup shows a strip of small policy icons beside each person — Auto on
 * one member, Home on another. That is **not derivable**: `Policy` links to
 * `Household` and to `Deal`, and never to a `Contact`, so nothing in the system
 * records which member a policy belongs to. Attributing them per person would
 * mean guessing. Tracked as PAC-55; listing policies in full here makes the gap
 * more visible, which is the honest outcome.
 */
export function HouseholdCard({ household }: HouseholdCardProps) {
  if (!household) {
    return (
      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Users size={14} className="text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Household
          </h2>
        </div>
        <p className="px-5 py-4 text-sm text-muted-foreground">
          This lead isn’t linked to a household yet.
        </p>
      </section>
    );
  }

  const activePolicies = household.policies.filter((policy) => policy.active);
  const premium = activePolicies.reduce(
    (total, policy) => total + policy.premium,
    0,
  );

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="space-y-2 border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Users size={14} className="shrink-0 text-muted-foreground" />
            <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {household.name ?? "Household"}
            </h2>
          </div>
          <HouseholdReference
            reference={household.reference}
            householdId={household.id}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {activePolicies.length || household.totalActivePolicies} active
          {premium > 0 && <> · {formatCurrency(premium)}/yr</>}
        </p>
      </header>

      <section className="border-b border-border">
        <SectionLabel>Members</SectionLabel>

        {household.members.length > 0 ? (
          <ul className="divide-y divide-border">
            {household.members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 px-5 py-3">
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[11px] font-bold text-primary"
                >
                  {initials(member.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm text-card-foreground">
                    {member.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      member.isPrimary ? "Primary" : member.role,
                      member.dateOfBirth
                        ? `DOB ${formatDate(member.dateOfBirth)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 pb-4 text-sm text-muted-foreground">
            No household members on file.
          </p>
        )}
      </section>

      <section>
        <SectionLabel>Policies</SectionLabel>

        {household.policies.length > 0 ? (
          <ul className="divide-y divide-border">
            {household.policies.map((policy) => (
              <li key={policy.id} className="px-5 py-3">
                <PolicyRow policy={policy} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 pb-4 text-sm text-muted-foreground">
            No policies bound on this household yet.
          </p>
        )}
      </section>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-5 pb-1 pt-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * The household's identifier (#7).
 *
 * Shows the short reference and copies the full id — a support conversation
 * starts from the readable chip, but anything that has to *find* the record
 * needs the id, and the reference is a display label rather than a lookup key.
 */
function HouseholdReference({
  reference,
  householdId,
}: {
  reference: string;
  householdId: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!reference) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(householdId);
      setCopied(true);
      toast.success("Household ID copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access needs a secure context and can be blocked outright,
      // so say so rather than leaving the button looking broken.
      toast.error("Couldn’t copy the household ID");
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void copy()}
      title={`Copy household ID ${householdId}`}
      className="h-6 gap-1.5 px-2 font-mono text-[11px] font-medium text-muted-foreground hover:text-foreground"
    >
      {reference}
      {copied ? (
        <Check size={11} className="text-emerald-500" />
      ) : (
        <Copy size={11} />
      )}
      <span className="sr-only">Copy household ID</span>
    </Button>
  );
}
