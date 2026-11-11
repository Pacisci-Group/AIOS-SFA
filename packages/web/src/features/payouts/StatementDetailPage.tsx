import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Calculator,
  CircleCheck,
  Loader2,
  MessageSquareWarning,
  Send,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import {
  isEditableStatementStatus,
  ModuleKey,
  type PayStatementView,
} from "@sfa/shared";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { formatMonth } from "@/lib/months";
import {
  getPayStatement,
  payStatementKey,
  recalculatePayStatement,
  reopenPayStatement,
  sendPayStatement,
} from "@/lib/payouts-api";
import { AcceptStatementDialog } from "./components/AcceptStatementDialog";
import { ActivityPanel } from "./components/ActivityPanel";
import { DisputeStatementDialog } from "./components/DisputeStatementDialog";
import { StatementAdjustmentsCard } from "./components/StatementAdjustmentsCard";
import { StatementAnswerCard } from "./components/StatementAnswerCard";
import { StatementBreakdown } from "./components/StatementBreakdown";
import { StatementInputsCard } from "./components/StatementInputsCard";
import { StatementPdfPanel } from "./components/StatementPdfPanel";
import { StatementStatusBadge } from "./components/StatementStatusBadge";
import { payoutErrorMessage } from "./payout-errors";
import { useIsOwnStatement, useOwnStatementBlocked } from "./own-statement";
import { formatInstantDay, POOL_LABELS } from "./payout-format";
import { useApplyStatement } from "./statement-cache";

const TAB_DEFAULTS = { tab: "" };
const TAB_ALLOWED = { tab: ["pdf", "activity"] as const };

type Confirming = "send" | "reopen" | null;
type Answering = "accept" | "dispute" | null;

/**
 * One commission statement (PAC-178), the same page for the reviewer and the
 * employee — the API decides who may open it (an employee only their own,
 * once sent; a 404 otherwise). The Statement tab mirrors the Commission
 * Statement's sections; Activity (PAC-179) lists the month's sales and
 * chargebacks behind it.
 *
 * A reviewer (`payouts:write`) may recalculate a draft or disputed one, and
 * enter the figures its structure needs (the compliance rate, retention, …;
 * 2026 comp plans) — not on their own statement without
 * `agency:payouts:admin`, and the same holds for sending and reopening it.
 *
 * PAC-181: the PDF tab shows the issued Commission Statement (or, for a
 * reviewer, a preview of a draft); a reviewer sends a draft or disputed
 * statement, and reopens a sent one until the employee answers.
 *
 * PAC-182: the statement's own employee — whatever their permissions —
 * answers a sent one: **Accept** signs it with their typed name (final; the
 * PDF tab then shows the signed copy) and **Dispute** sends it back with
 * notes. Where the answer stands shows above every tab. A reviewer corrects
 * a disputed statement — the chargeback lines, the entered amounts, each
 * with a note — and sends it again as the next version.
 */
export default function StatementDetailPage() {
  const { id = "" } = useParams();
  const { canWrite } = usePermissions();
  const reviewer = canWrite(ModuleKey.Payouts);
  const apply = useApplyStatement();
  const [view, setView] = useUrlState({
    defaults: TAB_DEFAULTS,
    allowed: TAB_ALLOWED,
  });

  const statement = useQuery({
    queryKey: payStatementKey(id),
    queryFn: () => getPayStatement(id),
    enabled: Boolean(id),
  });
  const recalculate = useMutation({
    mutationFn: () => recalculatePayStatement(id),
    onSuccess: async (updated) => {
      await apply(updated);
      toast.success("Statement recalculated.");
    },
    onError: (error) => toast.error(payoutErrorMessage(error)),
  });

  const [confirming, setConfirming] = useState<Confirming>(null);
  const [answering, setAnswering] = useState<Answering>(null);
  const applied = async (updated: PayStatementView) => {
    await apply(updated);
    setConfirming(null);
  };
  const send = useMutation({
    mutationFn: () => sendPayStatement(id),
    onSuccess: async (updated) => {
      await applied(updated);
      toast.success(`Statement sent to ${updated.userName}.`);
    },
    onError: (error) => {
      setConfirming(null);
      toast.error(payoutErrorMessage(error));
    },
  });
  const reopen = useMutation({
    mutationFn: () => reopenPayStatement(id),
    onSuccess: async (updated) => {
      await applied(updated);
      toast.success("Statement reopened.");
    },
    onError: (error) => {
      setConfirming(null);
      toast.error(payoutErrorMessage(error));
    },
  });
  const pending = send.isPending || reopen.isPending;

  const s = statement.data;
  // Not on one's own statement without `agency:payouts:admin` (the API's
  // `PAYOUT_STATEMENT_OWN_STATEMENT`): someone else decides one's pay.
  const ownBlocked = useOwnStatementBlocked(s);
  const issues = reviewer && !ownBlocked;
  // Only the employee answers, an admin on their own statement included —
  // who may then see Reopen beside these, which is theirs too.
  const answers = useIsOwnStatement(s) && s?.status === "sent";
  const backTo = reviewer && s ? `/payouts?month=${s.month}` : "/my-pay";
  const firstName = s?.userName.split(" ")[0] ?? "";

  return (
    <AppShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to={backTo} aria-label="Back">
              <ArrowLeft aria-hidden />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {s ? s.userName : "Commission statement"}
            </h1>
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {s
                ? `Commission statement · ${formatMonth(s.month)} · ${POOL_LABELS[s.pool]}`
                : "Loading"}
            </p>
            {s?.sentAt && (
              <p className="truncate text-xs text-muted-foreground">
                Sent {formatInstantDay(s.sentAt, s.timeZone)}
                {s.sentBy?.name ? ` by ${s.sentBy.name}` : ""}
              </p>
            )}
            {reviewer &&
              ownBlocked &&
              s &&
              (isEditableStatementStatus(s.status) || s.status === "sent") && (
                <p className="truncate text-xs text-muted-foreground">
                  Someone else recalculates, sends and reopens your own
                  statement.
                </p>
              )}
          </div>
          {s && <StatementStatusBadge status={s.status} version={s.version} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={view.tab || "statement"}
            onValueChange={(next) =>
              setView({
                tab: next === "activity" || next === "pdf" ? next : "",
              })
            }
          >
            <TabsList>
              <TabsTrigger value="statement">Statement</TabsTrigger>
              <TabsTrigger value="pdf">PDF</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
          </Tabs>
          {issues && s && isEditableStatementStatus(s.status) && (
            <Button
              size="sm"
              variant="outline"
              // Never while a send or reopen is in flight: a recalculation
              // landing mid-send is what makes the send a 409.
              disabled={recalculate.isPending || pending}
              onClick={() => recalculate.mutate()}
            >
              {recalculate.isPending ? (
                <Loader2 aria-hidden className="animate-spin" />
              ) : (
                <Calculator aria-hidden />
              )}
              Recalculate
            </Button>
          )}
          {issues && s && s.status === "sent" && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming("reopen")}
            >
              <Undo2 aria-hidden />
              Reopen
            </Button>
          )}
          {answers && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setAnswering("dispute")}
              >
                <MessageSquareWarning aria-hidden />
                Dispute
              </Button>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => setAnswering("accept")}
              >
                <CircleCheck aria-hidden />
                Accept
              </Button>
            </>
          )}
          {issues && s && isEditableStatementStatus(s.status) && (
            <Button
              size="sm"
              disabled={pending || recalculate.isPending}
              onClick={() => setConfirming("send")}
            >
              <Send aria-hidden />
              {s.status === "rejected" ? "Send again" : "Send"}
            </Button>
          )}
        </div>
      </header>

      <main className="w-full px-4 py-6 md:px-6">
        {statement.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-5 py-16 text-center">
            <AlertCircle aria-hidden className="size-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {payoutErrorMessage(statement.error)}
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to={backTo}>Back</Link>
            </Button>
          </div>
        ) : !s ? (
          <div className="space-y-6">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : (
          <div className="space-y-6">
            <StatementAnswerCard statement={s} reviewer={reviewer} />
            {view.tab === "activity" ? (
              <ActivityPanel userId={s.userId} month={s.month} />
            ) : view.tab === "pdf" ? (
              <StatementPdfPanel statement={s} reviewer={reviewer} />
            ) : (
              <StatementBreakdown
                statement={s}
                chargebacksEditable={
                  issues && isEditableStatementStatus(s.status)
                }
                figures={
                  <>
                    <StatementInputsCard statement={s} />
                    <StatementAdjustmentsCard statement={s} />
                  </>
                }
              />
            )}
          </div>
        )}
      </main>

      {s && (
        // Mounted whatever the status: an answer changes it before the
        // dialog has closed.
        <>
          <AcceptStatementDialog
            statement={s}
            open={answering === "accept"}
            onOpenChange={(next) => !next && setAnswering(null)}
          />
          <DisputeStatementDialog
            statement={s}
            open={answering === "dispute"}
            onOpenChange={(next) => !next && setAnswering(null)}
          />
        </>
      )}

      {s && (
        <AlertDialog
          open={confirming !== null}
          onOpenChange={(next) => !next && !pending && setConfirming(null)}
        >
          <AlertDialogContent>
            {confirming === "reopen" ? (
              <AlertDialogHeader>
                <AlertDialogTitle>Reopen this statement?</AlertDialogTitle>
                <AlertDialogDescription>
                  It goes back to draft as version {s.version + 1}. {firstName}{" "}
                  can no longer open it until it is sent again. The version they
                  were sent is kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
            ) : (
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Send this statement to {s.userName}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  They get a notification and can open it from My Pay. The PDF
                  is stored as version{" "}
                  {s.status === "rejected" ? s.version + 1 : s.version}, and its
                  figures cannot change unless you reopen it.
                </AlertDialogDescription>
              </AlertDialogHeader>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  if (confirming === "reopen") reopen.mutate();
                  else send.mutate();
                }}
              >
                {pending && (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                )}
                {confirming === "reopen" ? "Reopen" : "Send"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </AppShell>
  );
}
