import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Send,
  Undo2,
  UserCheck,
} from "lucide-react";
import { useState } from "react";
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
  DEAL_AUDIT_REASON_CODES,
  addAuditNote,
  assignAudit,
  getAuditWorkflow,
  listAuditNotes,
  reviewAudit,
  submitAudit,
  type AuditOwnerView,
  type DealAuditReasonCode,
  type DealAuditStatus,
} from "@/lib/deal-audits-api";
import { listRoles } from "@/lib/roles-api";
import { listUsers } from "@/lib/users-api";

/**
 * The audit's ownership, workflow actions and note thread (PAC-72 section E).
 *
 * Lives inside the hand-off drawer rather than on the board: the board answers
 * "which deals need work", and this answers "what is happening with this one".
 *
 * ⚠ Every action is gated on a server-supplied flag (`canSubmit` / `canReview`)
 * rather than on rules re-derived here. `canReview` in particular depends on
 * who submitted — the submitter may not review their own audit — and the client
 * is deliberately never told who that was.
 */

const STATUS_STYLES: Record<DealAuditStatus, string> = {
  "Not Submitted": "bg-muted text-muted-foreground",
  Pending: "bg-sky-400/15 text-sky-400",
  Pass: "bg-emerald-500/15 text-emerald-500",
  Fail: "bg-amber-500/15 text-amber-500",
};

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

export function AuditWorkflowPanel({ dealId }: { dealId: string }) {
  const queryClient = useQueryClient();
  const { can, canWrite } = usePermissions();
  const canAct = canWrite("deal_audits");
  // The pickers need a roster. Producers hold neither, so they see the owners
  // as text — which is the honest fallback rather than a control that 403s.
  const canPickUsers = can("agency:users:read");
  const canPickRoles = can("agency:roles:read");

  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reasonCodes, setReasonCodes] = useState<DealAuditReasonCode[]>([]);
  const [reviewNotes, setReviewNotes] = useState("");

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
    queryKey: ["agency-users"],
    queryFn: listUsers,
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
    // The board's status badge and counters read from a different query.
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

  const reviewMutation = useMutation({
    mutationFn: (payload: Parameters<typeof reviewAudit>[1]) =>
      reviewAudit(dealId, payload),
    onSuccess: () => {
      setReviewing(false);
      setReasonCodes([]);
      setReviewNotes("");
      refresh();
    },
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
  const busy =
    assignMutation.isPending ||
    submitMutation.isPending ||
    reviewMutation.isPending;

  /**
   * Options for a slot: every **active** user, plus every role as a queue.
   *
   * Deactivated users are filtered out — assigning work to a de-provisioned
   * account is how an audit quietly reaches nobody, which is the failure mode
   * the default assignee exists to prevent in the first place.
   */
  const ownerOptions = [
    ...(users.data ?? [])
      .filter((user) => user.isActive)
      .map((user) => ({
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
              STATUS_STYLES[state.auditStatus],
            )}
          >
            {state.auditStatus}
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

        {/*
          * Why it was sent back, if it was. Kept visible on a `Fail` because it
          * is the only thing telling the assignee what to actually fix — the
          * whole reason a reason code is required on that decision.
          */}
        {state.auditStatus === "Fail" && state.reasonCodes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {state.reasonCodes.map((code) => (
              <span
                key={code}
                className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-500"
              >
                {code}
              </span>
            ))}
          </div>
        )}
        {state.auditNotes && (
          <p className="text-xs text-muted-foreground">{state.auditNotes}</p>
        )}
      </div>

      {/* Actions */}
      {canAct && (
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

          {state.canReview && !reviewing && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => reviewMutation.mutate({ decision: "approve" })}
                className="flex-1 gap-1.5 bg-emerald-500/12 text-emerald-500 hover:bg-emerald-500/20"
              >
                <CheckCircle2 size={14} />
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setReviewing(true)}
                className="flex-1 gap-1.5 text-amber-500"
              >
                <AlertTriangle size={14} />
                Changes
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => reviewMutation.mutate({ decision: "send_back" })}
                className="gap-1.5 text-muted-foreground"
                aria-label="Send back to assignee"
              >
                <Undo2 size={14} />
              </Button>
            </div>
          )}

          {/*
            * Requesting changes needs at least one reason code — "it failed"
            * with nothing stated gives the assignee nothing to act on, and the
            * correction loop just bounces. The API enforces it; this makes the
            * requirement visible instead of a 400.
            */}
          {state.canReview && reviewing && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/8 p-3">
              <p className="text-xs font-medium text-foreground">
                What needs fixing?
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DEAL_AUDIT_REASON_CODES.map((code) => {
                  const picked = reasonCodes.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() =>
                        setReasonCodes((current) =>
                          picked
                            ? current.filter((c) => c !== code)
                            : [...current, code],
                        )
                      }
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        picked
                          ? "border-amber-500/40 bg-amber-500/20 text-amber-500"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
              <Textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={2}
                placeholder="Anything else the assignee needs to know…"
                className="resize-none border-border bg-background"
              />
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => {
                    setReviewing(false);
                    setReasonCodes([]);
                    setReviewNotes("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={busy || reasonCodes.length === 0}
                  onClick={() =>
                    reviewMutation.mutate({
                      decision: "request_changes",
                      reasonCodes,
                      notes: reviewNotes.trim() || undefined,
                    })
                  }
                >
                  {reviewMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : null}
                  Request changes
                </Button>
              </div>
            </div>
          )}

          {(assignMutation.isError ||
            submitMutation.isError ||
            reviewMutation.isError) && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
              <AlertTriangle size={14} className="shrink-0 text-destructive" />
              <p className="text-xs text-destructive">
                {(
                  (assignMutation.error ??
                    submitMutation.error ??
                    reviewMutation.error) as Error | undefined
                )?.message || "That didn't go through. Try again."}
              </p>
            </div>
          )}
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
