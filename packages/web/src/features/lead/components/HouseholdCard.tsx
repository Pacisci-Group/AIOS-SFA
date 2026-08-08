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
 *    The chip shows `HH-2614` and copying puts exactly that on the clipboard.
 *    It used to show a label derived from the ObjectId and copy the ObjectId
 *    instead, because the derived label was not unique enough to resolve a
 *    record; the reference is now a stored per-agency sequence, so the thing
 *    you read is the thing you paste. See `record-reference.ts`.
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
          <HouseholdReference reference={household.reference} />
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
 * Renders nothing when the reference is empty — a household migrated before
 * `householdRef` existed and not yet backfilled. An absent chip is honest; a
 * bare `HH-` is not.
 */
function HouseholdReference({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);

  if (!reference) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      toast.success(`Copied ${reference}`);
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
      size="xs"
      onClick={() => void copy()}
      title={`Copy household ID ${reference}`}
      className="font-mono font-medium text-muted-foreground hover:text-foreground"
    >
      {/*
       * `translate-y-[0.5px]` is an optical correction, not a fudge.
       *
       * Flexbox centres the *line box*, which puts the baseline at
       * `(height + ascent - descent) / 2`. Optically centred caps want it at
       * `(height + capHeight) / 2`, and those agree only when
       * `ascent - descent === capHeight`. That holds for Inter, which is why
       * the heading beside this needs nothing; it does not hold for
       * `ui-monospace`, whose asymmetric metrics leave `HH-2614` sitting
       * 0.51px high — measured in the browser, and enough to snap the text
       * onto a different pixel row from the heading at this size.
       *
       * On the text only: the icon is a replaced box with no baseline, so it
       * is already centred and shifting it would break what works. The
       * alternative fix — dropping `font-mono` — aligns perfectly but breaks
       * ranks with the policy numbers rendered just below in this same card.
       */}
      <span className="translate-y-[0.5px]">{reference}</span>
      {copied ? (
        <Check size={11} className="text-emerald-500" />
      ) : (
        <Copy size={11} />
      )}
      <span className="sr-only">Copy household ID</span>
    </Button>
  );
}
