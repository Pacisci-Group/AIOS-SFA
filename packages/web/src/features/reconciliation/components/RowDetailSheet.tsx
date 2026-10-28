import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import {
  AgencyPermission,
  MAX_RECONCILIATION_ASSIGNMENT_NOTE_LENGTH,
  ModuleKey,
  RECONCILIATION_IGNORED_REASON_LABELS,
  RECONCILIATION_RESOLUTION_LABELS,
  RECONCILIATION_RESOLUTIONS,
  RECONCILIATION_RESOLUTIONS_BY_TAB,
  RECONCILIATION_REVIEW_STATUS_LABELS,
  RECONCILIATION_REVIEW_STATUSES,
  RECONCILIATION_TAB_LABELS,
  type ReconciliationResolution,
} from "@sfa/shared";
import { DataRow, SectionLabel } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/contexts/auth-context";
import { useAppForm } from "@/hooks/form";
import { usePermissions } from "@/hooks/usePermissions";
import {
  assignReconciliationRow,
  reconciliationKey,
  reviewReconciliationRow,
  type BindIdStatus,
  type ReconciliationAssignment,
  type ReconciliationRowView,
  type ReconciliationSuggestion,
} from "@/lib/carrier-reconciliation-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import {
  apiErrorMessage,
  formatDay,
  formatInstant,
  formatPremium,
  issueLabel,
  REVIEW_BADGE,
  rowPolicyNumber,
} from "../reconciliation-format";
import {
  assigneeRoleLabel,
  useReconciliationAssignees,
} from "../useReconciliationAssignees";

const BIND_STATUS_LABELS: Record<BindIdStatus, string> = {
  staff: "A staff member's Bind ID",
  former_staff:
    "Named in Dash but on no user — a former employee, or a code not entered yet",
  not_staff: "Not the Bind ID of anyone on staff",
  blank: "Dash sent none",
};

const SUGGESTION_REASONS: Record<ReconciliationSuggestion["reasons"][number], string> = {
  number_close: "number differs by a digit or two",
  same_surname: "same surname",
  premium_close: "premium within 10%",
  date_close: "within a week",
};

/**
 * One row in full: what Dash says beside what the app says, why it is
 * flagged, likely counterparts, who it is assigned to, and the decision on it.
 *
 * Opened from the owner's page and from an assignee's (PAC-173), so every
 * action in it is gated on its own permission: a Producer or CSR holds no
 * `carrier_reconciliation` permission and reads the row without the forms,
 * and a link shows only to a viewer whose page it opens would admit them.
 */
export function RowDetailSheet({
  runId,
  row,
  onClose,
  onRowChanged,
}: {
  runId: string;
  row: ReconciliationRowView | null;
  onClose: () => void;
  onRowChanged: (row: ReconciliationRowView) => void;
}) {
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border p-0 sm:w-[560px] sm:max-w-[560px]"
      >
        {row && (
          <RowDetail
            key={row.id}
            runId={runId}
            row={row}
            onRowChanged={onRowChanged}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function RowDetail({
  runId,
  row,
  onRowChanged,
}: {
  runId: string;
  row: ReconciliationRowView;
  onRowChanged: (row: ReconciliationRowView) => void;
}) {
  const { can, canAny } = usePermissions();
  const canWrite = can("carrier_reconciliation:write");
  // The policy and household pages admit either page permission (see App.tsx).
  const canOpenRecords = canAny([
    `${ModuleKey.Clients}:read`,
    `${ModuleKey.CrmService}:read`,
  ]);
  const { user } = useAuth();
  // `/sold/:id/edit` needs `deal_audits:write`, and a Producer's is scoped to
  // their own sales: someone else's would answer 404. The owner's page shows
  // it for every sale.
  const canEditSale =
    can(`${ModuleKey.DealAudits}:write`) &&
    (canWrite ||
      (!!row.app?.producerId && row.app.producerId === user?.id));
  // The API assigns only a row still waiting on a decision.
  const canAssign = canWrite && row.needsReview && row.review.status === "open";
  const { dash, app } = row;
  const showAppLinks =
    canOpenRecords || (canEditSale && app?.dealId != null);

  return (
    <>
      <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
        <SheetTitle className="flex flex-wrap items-center gap-2 tabular-nums">
          Policy {rowPolicyNumber(row)}
          {row.tabs.map((tab) => (
            <Badge key={tab} variant="secondary" size="sm">
              {RECONCILIATION_TAB_LABELS[tab]}
            </Badge>
          ))}
        </SheetTitle>
        <SheetDescription>
          {dash
            ? `Dash line ${dash.rowNumber} · ${dash.transactionType ?? "no transaction type"}`
            : "In the app only"}
          {row.ignoredReason
            ? ` · ${RECONCILIATION_IGNORED_REASON_LABELS[row.ignoredReason]}`
            : ""}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        {row.issues.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>Flags</SectionLabel>
            <ul className="space-y-1 text-sm">
              {row.issues.map((issue) => (
                <li key={issue}>• {issueLabel(issue)}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-3">
            <SectionLabel>Dash says</SectionLabel>
            {dash ? (
              <>
                <DataRow label="Customer" value={dash.customerName ?? NOT_AVAILABLE} />
                <DataRow
                  label="Product"
                  value={dash.productDescription ?? dash.product ?? NOT_AVAILABLE}
                />
                {/* Whoever's Bind ID bound it, by their name in the app — the
                    sub-producer Dash prints is not read (owner, 28 Oct 2026). */}
                <DataRow
                  label="Producer"
                  value={row.credit.userName ?? row.credit.name ?? NOT_AVAILABLE}
                />
                <DataRow
                  label="Bound by"
                  value={
                    dash.bindId
                      ? `${dash.bindId}${dash.bindIdName ? ` · ${dash.bindIdName}` : ""}`
                      : NOT_AVAILABLE
                  }
                />
                {row.bindIdStatus && (
                  <p className="text-sm text-muted-foreground">
                    {BIND_STATUS_LABELS[row.bindIdStatus]}
                  </p>
                )}
                <DataRow label="Written" value={formatDay(dash.dateWritten)} />
                <DataRow label="Issued" value={formatDay(dash.issuedDate)} />
                <DataRow
                  label="Premium · items"
                  value={`${formatPremium(dash.writtenPremium)} · ${dash.itemCount ?? NOT_AVAILABLE}`}
                />
                <DataRow
                  label="Channel"
                  value={[dash.channel, dash.channelIndicator].filter(Boolean).join(" · ") || NOT_AVAILABLE}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not in the report.
              </p>
            )}
          </div>
          <div className="space-y-3">
            <SectionLabel>The app says</SectionLabel>
            {app ? (
              <>
                <DataRow label="Client" value={app.clientName ?? NOT_AVAILABLE} />
                <DataRow
                  label="Policy"
                  value={[app.policyType, app.carrier, app.policyStatus]
                    .filter(Boolean)
                    .join(" · ") || NOT_AVAILABLE}
                />
                <DataRow label="Producer" value={app.producerName ?? NOT_AVAILABLE} />
                <DataRow label="Sold" value={formatDay(app.soldDay)} />
                <DataRow
                  label="Premium · items"
                  value={`${formatPremium(app.premium)} · ${app.items}`}
                />
                {showAppLinks && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {canOpenRecords && (
                      <Link
                        to={`/policies/${app.policyId}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Open policy
                      </Link>
                    )}
                    {canOpenRecords && app.householdId && (
                      <Link
                        to={`/clients/${app.householdId}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Open household
                      </Link>
                    )}
                    {canEditSale && app.dealId && (
                      <Link
                        to={`/sold/${app.dealId}/edit`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Edit sale
                      </Link>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No policy with this number in the app.
              </p>
            )}
          </div>
        </section>

        {row.suggestions.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>Possibly the same policy</SectionLabel>
            <ul className="space-y-2">
              {row.suggestions.map((suggestion, index) => (
                <li
                  key={`${suggestion.policyId ?? suggestion.rowId}-${index}`}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium tabular-nums">
                      {suggestion.policyNumber ?? NOT_AVAILABLE}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {suggestion.name ?? NOT_AVAILABLE} · {formatPremium(suggestion.premium)} ·{" "}
                        {formatDay(suggestion.day)}
                      </span>
                    </span>
                    {canOpenRecords && suggestion.kind === "app_policy" && suggestion.policyId && (
                      <Link
                        to={`/policies/${suggestion.policyId}`}
                        className={buttonVariants({ variant: "link", size: "sm" })}
                      >
                        Open
                      </Link>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {suggestion.kind === "app_policy" ? "In the app" : "In Dash"}:{" "}
                    {suggestion.reasons.map((reason) => SUGGESTION_REASONS[reason]).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Fixing a code is the owner's job; an assignee reading the row
            cannot set anyone's code or re-check the run. */}
        {dash && canWrite && <UnknownCodesHint row={row} />}

        {(canAssign || row.assignment) && (
          <section className="space-y-3">
            <SectionLabel>Assignment</SectionLabel>
            {row.assignment ? (
              <AssignmentSummary assignment={row.assignment} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Not assigned. Hand it to a Producer or CSR — they are notified
                and see it on their own page.
              </p>
            )}
            {canAssign && (
              <AssignmentForm runId={runId} row={row} onSaved={onRowChanged} />
            )}
          </section>
        )}

        {row.needsReview || row.review.status !== "open" ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <SectionLabel>Decision</SectionLabel>
              <Badge variant={REVIEW_BADGE[row.review.status]} size="sm">
                {RECONCILIATION_REVIEW_STATUS_LABELS[row.review.status]}
              </Badge>
            </div>
            {row.review.reviewedBy && (
              <p className="text-sm text-muted-foreground">
                {row.review.resolution
                  ? `${RECONCILIATION_RESOLUTION_LABELS[row.review.resolution]} — `
                  : ""}
                {row.review.reviewedBy.name}
                {row.review.carriedForward ? " (carried from the earlier upload)" : ""}
              </p>
            )}
            {canWrite ? (
              <ReviewForm runId={runId} row={row} onSaved={onRowChanged} />
            ) : (
              row.review.note && <p className="text-sm">{row.review.note}</p>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}

/**
 * Where to fix a Bind ID nobody on staff holds (PAC-173).
 *
 * Bind IDs live on the **users**, so one on no one is fixed by setting it on
 * that person — on the Users page, or by them on their profile — and then
 * re-checking the run. If it really is nobody's (Allstate's call centre), it
 * stays 1-800 and the decision below records that.
 *
 * A Bind ID Dash names is read as a former employee's and is never 1-800, but
 * it is offered here too: it is just as likely someone still on staff whose
 * Bind ID has not been entered yet, and setting it credits them.
 *
 * The link shows only to a viewer the Users page would admit.
 */
function UnknownCodesHint({ row }: { row: ReconciliationRowView }) {
  const { can } = usePermissions();
  const bindId =
    row.bindIdStatus === "not_staff" || row.bindIdStatus === "former_staff"
      ? row.dash?.bindId
      : null;
  if (!bindId) return null;

  return (
    <section className="space-y-2">
      <SectionLabel>Who is this?</SectionLabel>
      <p className="text-sm text-muted-foreground">
        Bind ID {bindId}
        {row.dash?.bindIdName ? ` (${row.dash.bindIdName})` : ""} is not on
        anyone on staff. If it belongs to one of the agency's people, set it on
        them on the Users page, then Re-check the run.
      </p>
      {can(AgencyPermission.UsersRead) && (
        <Link
          to="/settings/users"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Open Users
        </Link>
      )}
    </section>
  );
}

/** "Assigned to Sam by Olive on Oct 28, 3:04 PM", and the note left with it. */
function AssignmentSummary({
  assignment,
}: {
  assignment: ReconciliationAssignment;
}) {
  const { user } = useAuth();
  const assignee =
    assignment.user.id === user?.id ? "you" : assignment.user.name;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Assigned to{" "}
        <span className="font-medium text-card-foreground">{assignee}</span>
        {assignment.assignedBy ? ` by ${assignment.assignedBy.name}` : ""} on{" "}
        {formatInstant(assignment.assignedAt)}
      </p>
      {assignment.note && (
        <p className="border-l-2 border-border pl-3 text-sm whitespace-pre-line">
          {assignment.note}
        </p>
      )}
    </div>
  );
}

/** Radix `Select` refuses an empty-string value, so "nobody" needs a token. */
const UNASSIGNED = "__unassigned__";

const assignmentSchema = z.object({
  userId: z.string().min(1),
  note: z.string().trim().max(MAX_RECONCILIATION_ASSIGNMENT_NOTE_LENGTH),
});

type AssignmentValues = z.infer<typeof assignmentSchema>;

/** What a save did, for the toast. */
function assignmentSavedMessage(
  before: ReconciliationAssignment | null,
  after: ReconciliationAssignment | null,
): string {
  if (!after) return "Unassigned.";
  if (before?.user.id === after.user.id) return "Note saved.";
  return `Assigned to ${after.user.name}. They have been notified.`;
}

/**
 * Hand the row to a Producer or CSR, change who has it, or take it back
 * (PAC-173). A new assignee is notified; saving the same person again only
 * updates the note, and notifies no one. The note goes only with an assignee.
 */
function AssignmentForm({
  runId,
  row,
  onSaved,
}: {
  runId: string;
  row: ReconciliationRowView;
  onSaved: (row: ReconciliationRowView) => void;
}) {
  const queryClient = useQueryClient();
  const assignees = useReconciliationAssignees();
  const current = row.assignment;

  const save = useMutation({
    mutationFn: (values: AssignmentValues) =>
      assignReconciliationRow(
        runId,
        row.id,
        values.userId === UNASSIGNED
          ? { userId: null }
          : { userId: values.userId, note: values.note.trim() || null },
      ),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: reconciliationKey });
      toast.success(assignmentSavedMessage(current, updated.assignment));
      onSaved(updated);
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, "The assignment could not be saved.")),
  });

  const people = assignees.data ?? [];
  const options = [
    { value: UNASSIGNED, label: "Unassigned" },
    // Someone who stopped qualifying (deactivated, or no longer a Producer or
    // CSR) is still the row's assignee; kept so the picker names them.
    ...(current && !people.some((person) => person.id === current.user.id)
      ? [
          {
            value: current.user.id,
            label: assignees.isSuccess
              ? `${current.user.name} (can no longer be assigned)`
              : current.user.name,
            triggerLabel: current.user.name,
          },
        ]
      : []),
    ...people.map((person) => ({
      value: person.id,
      label: (
        <span className="flex items-baseline gap-2">
          {person.name}
          <span className="text-xs text-muted-foreground">
            {assigneeRoleLabel(person)}
          </span>
        </span>
      ),
      triggerLabel: person.name,
    })),
  ];

  const isUnchanged = (values: AssignmentValues) =>
    values.userId === (current?.user.id ?? UNASSIGNED) &&
    (values.userId === UNASSIGNED || values.note.trim() === (current?.note ?? ""));

  const form = useAppForm({
    defaultValues: {
      userId: current?.user.id ?? UNASSIGNED,
      note: current?.note ?? "",
    } as AssignmentValues,
    validators: { onSubmit: assignmentSchema },
    onSubmit: ({ value }) => save.mutate(value),
  });

  return (
    <form.AppForm>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="userId">
          {(f) => (
            <f.SelectField
              label="Assigned to"
              options={options}
              triggerClassName="w-full sm:w-72"
              description={
                assignees.isError
                  ? "Could not load who can be assigned. Close the row and open it again to retry."
                  : assignees.isSuccess && people.length === 0
                    ? "The agency has no active Producers or CSRs to assign to."
                    : undefined
              }
            />
          )}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values.userId}>
          {(userId) =>
            userId !== UNASSIGNED ? (
              <form.AppField name="note">
                {(f) => (
                  <f.TextareaField
                    label="Note for them"
                    rows={2}
                    placeholder="What to look into — optional"
                  />
                )}
              </form.AppField>
            ) : null
          }
        </form.Subscribe>
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={save.isPending || isUnchanged(values)}
              >
                {save.isPending ? "Saving…" : "Save assignment"}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </form.AppForm>
  );
}

const reviewSchema = z
  .object({
    status: z.enum(RECONCILIATION_REVIEW_STATUSES),
    resolution: z.string(),
    note: z.string().trim().max(2000),
  })
  .superRefine((value, ctx) => {
    if (value.status === "resolved" && !value.resolution) {
      ctx.addIssue({ code: "custom", path: ["resolution"], message: "Say how it was resolved" });
    }
  });

function ReviewForm({
  runId,
  row,
  onSaved,
}: {
  runId: string;
  row: ReconciliationRowView;
  onSaved: (row: ReconciliationRowView) => void;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (values: z.infer<typeof reviewSchema>) =>
      reviewReconciliationRow(runId, row.id, {
        status: values.status,
        resolution:
          values.status === "resolved"
            ? (values.resolution as ReconciliationResolution)
            : null,
        note: values.note || null,
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: reconciliationKey });
      toast.success("Decision saved.");
      onSaved(updated);
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, "The decision could not be saved.")),
  });

  // The resolutions that fit the row's tabs, in order, without repeats.
  const resolutions = [
    ...new Set(
      (row.tabs.length ? row.tabs : (["matched"] as const)).flatMap(
        (tab) => RECONCILIATION_RESOLUTIONS_BY_TAB[tab],
      ),
    ),
  ].filter((value) => RECONCILIATION_RESOLUTIONS.includes(value));
  // A stored resolution the row no longer offers — a retired one such as
  // `confirmed_1800`, or one from a tab the row has left — starts blank, so
  // saving asks for a current one instead of sending what the API refuses.
  const current = row.review.resolution;
  const initialResolution =
    current && (resolutions as readonly string[]).includes(current) ? current : "";

  const form = useAppForm({
    defaultValues: {
      status: row.review.status === "open" ? "resolved" : row.review.status,
      resolution: initialResolution,
      note: row.review.note ?? "",
    } as z.infer<typeof reviewSchema>,
    validators: { onSubmit: reviewSchema },
    onSubmit: ({ value }) => save.mutate(value),
  });

  return (
    <form.AppForm>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <form.AppField name="status">
            {(f) => (
              <f.SelectField
                label="Status"
                options={RECONCILIATION_REVIEW_STATUSES.map((status) => ({
                  value: status,
                  label: RECONCILIATION_REVIEW_STATUS_LABELS[status],
                }))}
                triggerClassName="w-full"
              />
            )}
          </form.AppField>
          <form.Subscribe selector={(state) => state.values.status}>
            {(status) =>
              status === "resolved" ? (
                <form.AppField name="resolution">
                  {(f) => (
                    <f.SelectField
                      label="Resolution"
                      placeholder="How was it resolved?"
                      options={resolutions.map((value) => ({
                        value,
                        label: RECONCILIATION_RESOLUTION_LABELS[value],
                      }))}
                      triggerClassName="w-full"
                    />
                  )}
                </form.AppField>
              ) : null
            }
          </form.Subscribe>
        </div>
        <form.AppField name="note">
          {(f) => (
            <f.TextareaField
              label="Note"
              rows={3}
              placeholder="What was done, and by whom"
            />
          )}
        </form.AppField>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save decision"}
          </Button>
        </div>
      </form>
    </form.AppForm>
  );
}
