import {
  AlertTriangle,
  Loader2,
  MessageSquare,
  PenLine,
  Send,
  UserCheck,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AUDIT_STATUS_STYLES,
  SENT_BACK_SURFACE,
  SENT_BACK_TEXT,
} from "@/features/deal-audits/components/review-display";
import { formatDate } from "@/features/lead/components/lead-display";
import {
  addAuditNote,
  assignAudit,
  getAuditWorkflow,
  listAuditNotes,
  submitAudit,
  type AuditOwnerView,
} from "@/lib/deal-audits-api";
import { listRoles } from "@/lib/roles-api";
import { agencyUserOptionsKey, listUserOptions } from "@/lib/users-api";

/**
 * The audit's ownership, workflow actions and note thread (PAC-72 section E).
 *
 * Lives inside the hand-off drawer rather than on the board: the board answers
 * "which deals need work", and this answers "what is happening with this one".
 *
 * **Reviewing is not here any more** (PAC-106). Approve and Send back moved to
 * the manager's Deal Audit page, where each item is ruled on before the audit
 * is; offering them in the producer's drawer let a producer try to rule on
 * their own work. In their place, a sent-back audit shows **who sent it back
 * and why**, with **Fix it** for the sale itself (B10). The Deal Audit page
 * reuses this panel as `variant="review"` for the ownership and thread only.
 *
 * ⚠ Every action is gated on a server-supplied flag (`canSubmit`) rather than
 * on rules re-derived here.
 */

/** Relative-ish timestamp; the thread is a conversation, not an audit log. */
function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function OwnerLine({
  label,
  owner,
}: {
  label: string;
  owner: AuditOwnerView | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-xs font-medium text-foreground">
        {owner ? (
          <>
            {owner.name}
            {owner.type === "role" && (
              // A role owner is a queue, not a person — worth saying so, since
              // "CRM" could otherwise read as somebody's name.
              <span className="ml-1 text-muted-foreground">(team)</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </span>
    </div>
  );
}

export function AuditWorkflowPanel({
  dealId,
  variant = "handoff",
}: {
  dealId: string;
  /**
   * `handoff` — the producer's drawer: Submit, and Fix it on a sent-back
   * audit. `review` — the manager's Deal Audit page, which has its own
   * decisions: ownership and the thread only.
   */
  variant?: "handoff" | "review";
}) {
  const queryClient = useQueryClient();
  const { can, canWrite } = usePermissions();
  const canAct = canWrite("deal_audits");
  const handoff = variant === "handoff";
  // The pickers need a roster. Producers hold neither, so they see the owners
  // as text — which is the honest fallback rather than a control that 403s.
  const canPickUsers = can("agency:users:read");
  const canPickRoles = can("agency:roles:read");

  const [note, setNote] = useState("");

  const workflowKey = ["audit-workflow", dealId] as const;
  const notesKey = ["audit-notes", dealId] as const;

  const workflow = useQuery({
    queryKey: workflowKey,
    queryFn: () => getAuditWorkflow(dealId),
  });
  const notes = useQuery({
    queryKey: notesKey,
    queryFn: () => listAuditNotes(dealId),
  });

  const users = useQuery({
    queryKey: agencyUserOptionsKey,
    queryFn: listUserOptions,
    enabled: canPickUsers,
  });
  const roles = useQuery({
    queryKey: ["agency-roles"],
    queryFn: listRoles,
    enabled: canPickRoles,
  });

  /** Every mutation refreshes the state and the thread, which it also writes to. */
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: workflowKey });
    void queryClient.invalidateQueries({ queryKey: notesKey });
    // The board's status badge and counters read from a different query, and
    // so do the manager's queue and Deal Audit page (all under this root).
    void queryClient.invalidateQueries({ queryKey: ["deal-audits"] });
  };

  const assignMutation = useMutation({
    mutationFn: (payload: Parameters<typeof assignAudit>[1]) =>
      assignAudit(dealId, payload),
    onSuccess: refresh,
  });

  const submitMutation = useMutation({
    mutationFn: () => submitAudit(dealId),
    onSuccess: refresh,
  });

  const noteMutation = useMutation({
    mutationFn: (body: string) => addAuditNote(dealId, body),
    onSuccess: () => {
      setNote("");
      refresh();
    },
  });

  if (workflow.isPending) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" />
        Loading hand-off…
      </div>
    );
  }

  if (workflow.isError || !workflow.data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
        <AlertTriangle size={14} className="shrink-0 text-amber-500" />
        <p className="flex-1 text-xs text-muted-foreground">
          Couldn't load the hand-off state.
        </p>
        <Button variant="ghost" size="sm" onClick={() => void workflow.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const state = workflow.data;
  const busy = assignMutation.isPending || submitMutation.isPending;

  /**
   * Options for a slot: every **active** user, plus every role as a queue.
   *
   * Deactivated users are filtered out — assigning work to a de-provisioned
   * account is how an audit quietly reaches nobody, which is the failure mode
   * the default assignee exists to prevent in the first place.
   */
  const ownerOptions = [
    // Active-only and platform-admin-free server-side (`/users/options`).
    ...(users.data ?? []).map((user) => ({
        value: `user:${user._id}`,
        label:
          [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
          user.email,
      })),
    ...(roles.data ?? []).map((role) => ({
      value: `role:${role._id}`,
      label: `${role.name} (team)`,
    })),
  ];

  const assign = (slot: "assignee" | "reviewer", raw: string) => {
    const [type, id] = raw.split(":");
    assignMutation.mutate({
      [slot]:
        raw === "none"
          ? null
          : { type: type as "user" | "role", id: id ?? "" },
    });
  };

  const OwnerPicker = ({
    slot,
    label,
    owner,
  }: {
    slot: "assignee" | "reviewer";
    label: string;
    owner: AuditOwnerView | null;
  }) => (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <Select
        value={owner ? `${owner.type}:${owner.id}` : "none"}
        onValueChange={(value) => assign(slot, value)}
        disabled={busy}
      >
        <SelectTrigger size="sm" className="max-w-[190px]">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Unassigned</SelectItem>
          {ownerOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const canPick = canAct && (canPickUsers || canPickRoles);
  const sentBack = state.auditStatus === "Fail" ? state.sentBack : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Status + ownership */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-sunken p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Hand-off
          </span>
          <Badge
            className={cn(
              "rounded-full border-transparent text-xs font-bold",
              AUDIT_STATUS_STYLES[state.auditStatus],
            )}
          >
            {state.auditStatus === "Fail" ? "Sent back" : state.auditStatus}
          </Badge>
        </div>

        {canPick ? (
          <>
            <OwnerPicker
              slot="assignee"
              label="Assignee"
              owner={state.assignee}
            />
            <OwnerPicker
              slot="reviewer"
              label="Reviewer"
              owner={state.reviewer}
            />
          </>
        ) : (
          <>
            <OwnerLine label="Assignee" owner={state.assignee} />
            <OwnerLine label="Reviewer" owner={state.reviewer} />
          </>
        )}

        {state.auditNotes && !sentBack && (
          <p className="text-xs text-muted-foreground">{state.auditNotes}</p>
        )}
      </div>

      {/*
        * Who sent it back and why (PAC-106) — the one thing telling the
        * producer what to fix. The failed items themselves are in the list
        * below, each with the manager's note.
        */}
      {handoff && sentBack && (
        <div
          className={cn(
            "flex flex-col gap-2 rounded-xl border p-3",
            SENT_BACK_SURFACE,
          )}
        >
          <p className={cn("text-sm font-medium", SENT_BACK_TEXT)}>
            Sent back by {sentBack.byName ?? "your manager"} ·{" "}
            {formatDate(sentBack.at)}
          </p>
          {sentBack.note && (
            <p className="text-sm text-foreground">{sentBack.note}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {sentBack.failedItemCount}{" "}
            {sentBack.failedItemCount === 1 ? "item needs" : "items need"} fixing.
            Wrong sold date or a missing policy? Fix the sale itself.
          </p>
          {canAct && (
            // B10: the sale is corrected on its own page; a sent-back audit
            // no longer blocks it (PAC-106).
            <Button
              asChild
              variant="outline"
              size="sm"
              className="self-start"
            >
              <Link to={`/sold/${dealId}/edit`}>
                <PenLine />
                Fix it
              </Link>
            </Button>
          )}
        </div>
      )}

      {/* Actions */}
      {handoff && canAct && (
        <div className="flex flex-col gap-2">
          {state.canSubmit && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => submitMutation.mutate()}
              className="justify-center gap-2"
            >
              {submitMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {state.auditStatus === "Fail"
                ? "Resubmit for review"
                : "Submit for review"}
            </Button>
          )}
        </div>
      )}

      {(assignMutation.isError || submitMutation.isError) && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
          <AlertTriangle size={14} className="shrink-0 text-destructive" />
          <p className="text-xs text-destructive">
            {(
              (assignMutation.error ?? submitMutation.error) as
                | Error
                | undefined
            )?.message || "That didn't go through. Try again."}
          </p>
        </div>
      )}

      {/* Thread — notes and workflow events in one list. */}
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Activity
        </p>

        {canAct && (
          <div className="flex flex-col gap-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Leave a note for whoever picks this up…"
              disabled={noteMutation.isPending}
              className="resize-none border-border bg-sunken"
            />
            <Button
              variant="outline"
              size="sm"
              className="self-end gap-1.5"
              disabled={!note.trim() || noteMutation.isPending}
              onClick={() => noteMutation.mutate(note.trim())}
            >
              {noteMutation.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <MessageSquare size={13} />
              )}
              Add note
            </Button>
          </div>
        )}

        {notes.isPending ? (
          <p className="py-2 text-xs text-muted-foreground">Loading activity…</p>
        ) : notes.data && notes.data.length > 0 ? (
          <ul className="flex flex-col gap-2.5">
            {notes.data.map((entry) => (
              <li key={entry.id} className="flex gap-2.5">
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {entry.type === "note" ? (
                    <MessageSquare size={13} />
                  ) : (
                    <UserCheck size={13} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-foreground">
                    {entry.summary}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {entry.userName || "System"} ·{" "}
                    {formatWhen(entry.occurredAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-xs text-muted-foreground">
            Nothing recorded yet.
          </p>
        )}
      </div>
    </div>
  );
}
