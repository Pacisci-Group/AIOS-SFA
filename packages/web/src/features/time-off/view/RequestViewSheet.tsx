import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  TIME_OFF_DAY_MODE_LABELS,
  TIME_OFF_REQUEST_STATUS_LABELS,
  type TimeOffRequestAction,
  type TimeOffRequestView,
} from "@sfa/shared";
import { DataRow, SectionLabel } from "@/components/common/DetailCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDay } from "@/features/hr/policies/policy-display";
import { formatBalance } from "@/features/hr/policies/time-off/time-off-display";
import { PersonSheet } from "@/features/people/sheets/PersonSheet";
import { ApiError } from "@/lib/api-client";
import {
  decideTimeOffRequest,
  discardTimeOffRequest,
  getTimeOffRequest,
  submitTimeOffRequest,
  timeOffKeys,
  timeOffRefusalRequest,
  type TimeOffDecision,
} from "@/lib/time-off-api";
import { cn } from "@/lib/utils";
import { BalanceBreakdown } from "../request/BalanceBreakdown";
import {
  DAY_REASON_LABEL,
  GROUP_BADGE,
  requestDates,
  requestPolicyName,
  requestReference,
} from "../time-off-request-display";
import { DecisionDialog, type DecisionCopy } from "./DecisionDialog";
import { RequestTimeline } from "./RequestTimeline";

/** The actions that ask for a note (or a confirmation) before they run. */
type Asked = Exclude<TimeOffRequestAction, "edit" | "submit">;

function decisionCopy(action: Asked, request: TimeOffRequestView, reviewing: boolean): DecisionCopy {
  const who = request.employee?.name ?? "the employee";
  switch (action) {
    case "approve":
      return {
        title: "Approve this request?",
        description: `${formatBalance(request.totalHours)} will be taken from ${who}'s balance on the leave days.`,
        noteLabel: "Note for the employee",
        noteRequired: false,
        confirmLabel: "Approve",
      };
    case "request_changes":
      return {
        title: "Request changes",
        description: `The request goes back to ${who} to edit and send again.`,
        noteLabel: "What should change?",
        noteRequired: true,
        confirmLabel: "Request changes",
      };
    case "decline":
      return {
        title: "Decline this request?",
        description: `A declined request is final. ${who} can send a new one.`,
        noteLabel: "Why is it declined?",
        noteRequired: true,
        confirmLabel: "Decline",
      };
    case "discard":
      return {
        title: "Discard this draft?",
        description: "It was never sent, so nobody is told.",
        noteLabel: "",
        noteRequired: false,
        noteHidden: true,
        confirmLabel: "Discard draft",
      };
    case "cancel":
      return request.status === "approved"
        ? {
            title: "Cancel this approved leave?",
            description: reviewing
              ? `The hours go back to ${who}'s balance and they are told.`
              : "The hours go back to your balance and the reviewers are told.",
            noteLabel: reviewing ? "Why is it cancelled?" : "Note",
            noteRequired: reviewing,
            confirmLabel: "Cancel leave",
          }
        : {
            title: "Cancel this request?",
            description: "It is withdrawn before anyone decides it.",
            noteLabel: "Note",
            noteRequired: false,
            confirmLabel: "Cancel request",
          };
  }
}

const ACTION_TO_DECISION: Record<Exclude<Asked, "discard">, TimeOffDecision> = {
  approve: "approve",
  request_changes: "request-changes",
  decline: "decline",
  cancel: "cancel",
};

const DONE: Record<TimeOffRequestAction, string> = {
  edit: "",
  submit: "Request sent.",
  discard: "Draft discarded.",
  cancel: "Cancelled.",
  approve: "Approved.",
  request_changes: "Sent back for changes.",
  decline: "Declined.",
};

/**
 * One request (PAC-165): what was asked for, hour by hour, its balance
 * lines while it is still to be decided, who else is off (a reviewer's
 * view), the timeline, and the actions open to whoever is looking.
 *
 * The buttons are the API's `actions[]` — the server decides whether the
 * viewer is the employee or a reviewer and what the status allows, and this
 * renders the answer. A decision somebody else made first comes back as a
 * `409` carrying the record; the window refreshes to it rather than erroring.
 */
export function RequestViewSheet({
  requestId,
  onClose,
  onEdit,
}: {
  requestId: string;
  onClose: () => void;
  onEdit: (request: TimeOffRequestView) => void;
}) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<Asked | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: timeOffKeys.request(requestId),
    queryFn: () => getTimeOffRequest(requestId),
    retry: false,
  });
  const request = query.data;

  const act = useMutation({
    mutationFn: async ({ action, note }: { action: TimeOffRequestAction; note?: string }) => {
      if (action === "submit") return submitTimeOffRequest(requestId);
      if (action === "discard") {
        await discardTimeOffRequest(requestId);
        return null;
      }
      if (action === "edit") return null;
      return decideTimeOffRequest(requestId, ACTION_TO_DECISION[action], note);
    },
    onSuccess: async (updated, { action }) => {
      setAsking(null);
      setError(null);
      if (updated) queryClient.setQueryData(timeOffKeys.request(requestId), updated);
      toast.success(
        action === "submit" && updated?.status === "approved"
          ? "Approved automatically."
          : DONE[action],
      );
      if (action === "discard") onClose();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: timeOffKeys.all,
          // The open request was just written from the response.
          predicate: (entry) => action === "discard" || entry.queryKey[1] !== "request",
        }),
        queryClient.invalidateQueries({ queryKey: ["people"] }),
      ]);
    },
    onError: (failure) => {
      // Somebody else got there first: show what they did.
      const current = timeOffRefusalRequest(failure);
      if (current) {
        queryClient.setQueryData(timeOffKeys.request(requestId), current);
        void queryClient.invalidateQueries({ queryKey: timeOffKeys.all });
        setAsking(null);
      }
      setError(failure instanceof ApiError ? failure.message : "Could not save. Try again.");
    },
  });

  const run = (action: TimeOffRequestAction) => {
    setError(null);
    if (!request) return;
    if (action === "edit") onEdit(request);
    else if (action === "submit") act.mutate({ action });
    else setAsking(action);
  };

  const reviewing = Boolean(
    request?.actions.some((action) => action === "approve") ||
      (request?.othersOff !== undefined && request.actions.includes("cancel")),
  );

  return (
    <PersonSheet
      eyebrow={request ? requestReference(request) : "Time off request"}
      title={request ? requestPolicyName(request) : "Loading…"}
      onClose={onClose}
    >
      <div className="flex flex-1 flex-col gap-5 px-6 py-5">
        {query.isPending && (
          <div className="grid gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {query.isError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>
              {query.error instanceof ApiError && query.error.status === 404
                ? "That request does not exist, or it is not yours to see."
                : "Could not load the request. Try again."}
            </AlertDescription>
          </Alert>
        )}

        {request && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                size="sm"
                className={cn("font-semibold", GROUP_BADGE[request.group].className)}
              >
                {GROUP_BADGE[request.group].label}
              </Badge>
              {request.autoApproved && (
                <span className="text-sm text-muted-foreground">Approved automatically</span>
              )}
              {request.recordedBy && (
                <span className="text-sm text-muted-foreground">
                  Recorded by {request.recordedBy.name}
                </span>
              )}
              {request.source === "legacy" && (
                <span className="text-sm text-muted-foreground">
                  Imported from SmartSuite — read only
                </span>
              )}
            </div>

            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <DataRow label="Employee" value={request.employee?.name ?? null} />
              <DataRow label="Dates" value={requestDates(request)} />
              <DataRow label="Hours" value={formatBalance(request.totalHours)} />
              <DataRow
                label="Time requested"
                value={request.dayMode ? TIME_OFF_DAY_MODE_LABELS[request.dayMode] : null}
              />
              {request.legacy?.status && (
                <DataRow label="Status in SmartSuite" value={request.legacy.status} />
              )}
            </div>

            {request.note && (
              <section>
                <SectionLabel>Note</SectionLabel>
                <p className="mt-2 whitespace-pre-line rounded-r-md border-l-2 border-primary/50 bg-sunken py-2 pr-2 pl-3 text-sm text-foreground">
                  {request.note}
                </p>
              </section>
            )}

            {request.days.length > 0 && (
              <section>
                <SectionLabel>Hours per date</SectionLabel>
                <ul className="mt-2 rounded-lg border border-border">
                  {request.days.map((day, index) => (
                    <li
                      key={day.date}
                      className={cn(
                        "flex items-center justify-between gap-3 px-4 py-2 text-sm",
                        index < request.days.length - 1 && "border-b border-border",
                      )}
                    >
                      <span className={day.hours > 0 ? "text-foreground" : "text-muted-foreground"}>
                        {formatDay(day.date)}
                        {DAY_REASON_LABEL[day.reason] && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {DAY_REASON_LABEL[day.reason]}
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "tabular-nums",
                          day.hours > 0 ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {formatBalance(day.hours)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {request.balance && (
              <section>
                <SectionLabel>Time off balance</SectionLabel>
                <BalanceBreakdown
                  className="mt-2"
                  balance={request.balance}
                  projection={request.projection}
                />
              </section>
            )}

            {request.othersOff !== undefined && (
              <section>
                <SectionLabel>Also off on these dates</SectionLabel>
                {request.othersOff.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Nobody else in the branch.
                  </p>
                ) : (
                  <ul className="mt-2 grid gap-1.5">
                    {request.othersOff.map((other) => (
                      <li
                        key={`${other.employee.id}-${other.firstDay}`}
                        className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                      >
                        <span className="text-foreground">{other.employee.name}</span>
                        <span className="text-muted-foreground">
                          {requestDates(other)} · {TIME_OFF_REQUEST_STATUS_LABELS[other.status]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section>
              <SectionLabel>Timeline</SectionLabel>
              <div className="mt-3">
                <RequestTimeline entries={request.timeline} />
              </div>
            </section>

            {error && !asking && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {request.actions.length > 0 && (
              <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                {request.actions.map((action) => (
                  <ActionButton
                    key={action}
                    action={action}
                    request={request}
                    disabled={act.isPending}
                    onClick={() => run(action)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {asking && request && (
        <DecisionDialog
          key={asking}
          copy={decisionCopy(asking, request, reviewing)}
          pending={act.isPending}
          error={error}
          onClose={() => {
            setAsking(null);
            setError(null);
          }}
          onConfirm={(note) => act.mutate({ action: asking, note })}
        />
      )}
    </PersonSheet>
  );
}

/** One of the API's actions as a button; the one that moves the request on is the primary. */
function ActionButton({
  action,
  request,
  disabled,
  onClick,
}: {
  action: TimeOffRequestAction;
  request: TimeOffRequestView;
  disabled: boolean;
  onClick: () => void;
}) {
  const label: Record<TimeOffRequestAction, string> = {
    edit: "Edit",
    submit: request.status === "changes_requested" ? "Send again" : "Send request",
    discard: "Discard draft",
    cancel: request.status === "approved" ? "Cancel leave" : "Cancel request",
    approve: "Approve",
    request_changes: "Request changes",
    decline: "Decline",
  };
  const primary = action === "submit" || action === "approve";
  return (
    <Button
      type="button"
      variant={primary ? "brand" : action === "edit" ? "outline" : "ghost"}
      disabled={disabled}
      onClick={onClick}
      // The primary action reads last, at the right edge.
      className={primary ? "order-last" : undefined}
    >
      {label[action]}
    </Button>
  );
}
