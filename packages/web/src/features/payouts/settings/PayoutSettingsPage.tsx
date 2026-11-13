import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  ANY_CARRIER,
  leadSourceRuleCarrierLabel,
  rateRuleCarrierLabel,
  type PaymentStructureSummary,
} from "@sfa/shared";
import { DetailCard } from "@/components/common/DetailCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, formatPercent } from "@/lib/money";
import { NOT_AVAILABLE } from "@/lib/not-available";
import {
  archivePaymentStructure,
  listPaymentStructures,
  paymentStructuresKey,
  payoutsKey,
  payoutSettingsKey,
  getPayoutSettings,
} from "@/lib/payouts-api";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { payoutErrorMessage } from "../payout-errors";
import { SalespersonOfMonthForm, TeamBonusForm } from "./payout-settings-forms";

/**
 * Workspace Settings → Payouts (PAC-177): how the agency pays its people.
 *
 * Two agency-wide bonuses (the team pool, Salesperson of the Month) and the
 * payment structures — the per-person rules. All of it is
 * `agency:payouts:admin`; the route and the API both enforce it.
 */
export default function PayoutSettingsPage() {
  return (
    <SettingsPage
      title="Payouts"
      caption="Payment structures and bonuses"
      icon={Banknote}
      width="wide"
    >
      <div className="space-y-6">
        <StructuresCard />
        <div className="grid gap-6 lg:grid-cols-2">
          <SettingsCards />
        </div>
      </div>
    </SettingsPage>
  );
}

function SettingsCards() {
  const query = useQuery({
    queryKey: payoutSettingsKey,
    queryFn: getPayoutSettings,
  });
  /*
   * Bumped after a card's save to re-seed that card from what the server
   * stored, by remounting it — a background refetch never rewrites a form
   * mid-edit. One per card: a shared seed would remount the other card too
   * and throw away its unsaved edits.
   */
  const [teamSeed, setTeamSeed] = useState(0);
  const [somSeed, setSomSeed] = useState(0);

  if (query.isPending) {
    return (
      <>
        <Skeleton className="h-80 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </>
    );
  }
  if (query.isError) {
    return (
      <p className="text-sm text-destructive">
        {payoutErrorMessage(query.error)}
      </p>
    );
  }

  return (
    <>
      <DetailCard
        title="Team bonus"
        subheading="Fixed pools shared when the agency's month reaches a level."
      >
        <TeamBonusForm
          key={`team-${teamSeed}`}
          initial={query.data.teamBonus}
          onSaved={() => setTeamSeed((previous) => previous + 1)}
        />
      </DetailCard>
      <DetailCard
        title="Salesperson of the Month"
        subheading="A fixed bonus for the month's top seller."
      >
        <SalespersonOfMonthForm
          key={`som-${somSeed}`}
          initial={query.data.salespersonOfMonth}
          onSaved={() => setSomSeed((previous) => previous + 1)}
        />
      </DetailCard>
    </>
  );
}

function StructuresCard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: paymentStructuresKey,
    queryFn: listPaymentStructures,
  });
  const [archiving, setArchiving] = useState<PaymentStructureSummary | null>(
    null,
  );

  const archive = useMutation({
    mutationFn: (structure: PaymentStructureSummary) =>
      archivePaymentStructure(structure.id),
    onSuccess: async (structure) => {
      await queryClient.invalidateQueries({ queryKey: payoutsKey });
      setArchiving(null);
      toast.success(`${structure.name} archived.`);
    },
    onError: (error) => toast.error(payoutErrorMessage(error)),
  });

  return (
    <DetailCard
      title="Payment structures"
      subheading="Rates per carrier and lead source, bonuses, and who is paid that way."
      action={
        <Button asChild size="sm">
          <Link to="/settings/payouts/structures/new">
            <Plus size={14} />
            New structure
          </Link>
        </Button>
      }
    >
      {query.isPending ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : query.isError ? (
        <p className="text-sm text-destructive">
          {payoutErrorMessage(query.error)}
        </p>
      ) : query.data.structures.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No payment structures yet. Create one, set its rates and add the
          people it pays — commission statements are drafted for everyone on a
          structure.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {query.data.structures.map((structure) => (
            <StructureRow
              key={structure.id}
              structure={structure}
              onArchive={() => setArchiving(structure)}
            />
          ))}
        </ul>
      )}

      <AlertDialog
        open={archiving !== null}
        onOpenChange={(next) =>
          !next && !archive.isPending && setArchiving(null)
        }
      >
        {archiving && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive {archiving.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {archiving.memberCount === 0
                  ? "Nobody is on it."
                  : `${archiving.memberCount === 1 ? "The 1 person" : `The ${archiving.memberCount} people`} on it will be on no structure, and get no commission statement until you add them to another.`}{" "}
                Statements already drafted keep the rates they were made with.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={archive.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={archive.isPending}
                onClick={(event) => {
                  // Stay open while the request runs, so a failure is seen.
                  event.preventDefault();
                  archive.mutate(archiving);
                }}
              >
                {archive.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </DetailCard>
  );
}

function StructureRow({
  structure,
  onArchive,
}: {
  structure: PaymentStructureSummary;
  onArchive: () => void;
}) {
  const rates = structure.rules
    .map((rule) => {
      const rate = `${rateRuleCarrierLabel(rule.carrier)} ${formatPercent(rule.ratePercent)}`;
      return rule.minBundleRatePercent === null ||
        rule.minBundleRatePercent === undefined
        ? rate
        : `${rate} (min. bundle ${formatPercent(rule.minBundleRatePercent)})`;
    })
    .join(" · ");
  // "JYA 5% · JYA on Allstate 6%" — the overrides, in the API's order (by
  // source name, then carrier with "any carrier" last).
  const overrides = structure.leadSourceRules
    .map((rule) => {
      const source = rule.leadSourceName || NOT_AVAILABLE;
      const carrier =
        rule.carrier === ANY_CARRIER
          ? ""
          : ` on ${leadSourceRuleCarrierLabel(rule.carrier)}`;
      return `${source}${carrier} ${formatPercent(rule.ratePercent)}`;
    })
    .join(" · ");
  const bonuses = [
    structure.hatTrick.enabled
      ? `Hat trick ${structure.hatTrick.dealsPerDay} sales → ${formatMoney(structure.hatTrick.bonusAmount)}`
      : null,
    structure.individualTiers.length
      ? `${structure.individualTiers.length} monthly ${structure.individualTiers.length === 1 ? "tier" : "tiers"}${structure.tiersStackable && structure.individualTiers.length > 1 ? ", stacking" : ""}`
      : null,
    structure.teamBonusEligible ? "Team bonus" : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <Link
          to={`/settings/payouts/structures/${structure.id}`}
          className="text-sm font-semibold text-foreground hover:underline"
        >
          {structure.name}
        </Link>
        <p className="text-sm text-muted-foreground">{rates}</p>
        {overrides ? (
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground">Lead sources:</span> {overrides}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {bonuses.length ? bonuses.join(" · ") : "No bonuses"}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {structure.memberCount === 1
          ? "1 person"
          : `${structure.memberCount} people`}
      </p>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to={`/settings/payouts/structures/${structure.id}`}>Edit</Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={onArchive}
        >
          Archive
        </Button>
      </div>
    </li>
  );
}
