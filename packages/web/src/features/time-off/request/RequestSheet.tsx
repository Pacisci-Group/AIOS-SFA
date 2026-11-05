import { useMemo, useRef, useState } from "react";
import { useStore } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Info } from "lucide-react";
import { toast } from "sonner";
import {
  TIME_OFF_DAY_MODE_LABELS,
  type RecordablePersonView,
  type TimeOffPolicyRef,
  type TimeOffPreview,
  type TimeOffRequestDay,
  type TimeOffRequestView,
} from "@sfa/shared";
import { FormError, FormGrid } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { formatDay } from "@/features/hr/policies/policy-display";
import { formatBalance } from "@/features/hr/policies/time-off/time-off-display";
import { PersonSheet } from "@/features/people/sheets/PersonSheet";
import { useAppForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import { agencyTodayYmd } from "@/lib/dates";
import {
  createTimeOffRequest,
  recordTimeOff,
  submitTimeOffRequest,
  timeOffKeys,
  updateTimeOffRequest,
} from "@/lib/time-off-api";
import { DAY_REASON_LABEL } from "../time-off-request-display";
import { BalanceBreakdown } from "./BalanceBreakdown";
import {
  previewable,
  requestFormDefaults,
  requestFormSchema,
  toRecordInput,
  toRequestInput,
  type RequestFormMode,
  type RequestFormValues,
} from "./request-form";
import { useRequestPreview } from "./use-request-preview";

type Intent = "draft" | "send";

interface RequestSheetProps {
  /**
   * `self` — the caller's own request: a new one for `policy`, or `request`
   * (a Draft, or one sent back for changes) being edited. `record` — time
   * off recorded for someone else, created already Approved.
   */
  mode: RequestFormMode;
  /** Self, new request: the policy whose card was clicked. */
  policy?: TimeOffPolicyRef;
  /** Self: the saved request being edited. */
  request?: TimeOffRequestView;
  /** Record: the people the caller may record for. */
  people?: readonly RecordablePersonView[];
  /** Record: the person, when opened from their profile — the picker is fixed. */
  employeeId?: string;
  /** Self: nobody else can decide the caller's requests yet. */
  noReviewer?: boolean;
  onClose: () => void;
  /** After a save: the request as the server now holds it. */
  onSaved?: (request: TimeOffRequestView) => void;
}

/**
 * The request form (PAC-165) — Gusto's four inputs over our lifecycle:
 * the policy (chosen by the card that was clicked), a date range, Full days
 * or Partial days, and a note.
 *
 * Nothing about hours or balance is worked out here. As the form is filled
 * in the server answers with the hours each date takes (from the person's
 * work week and holiday calendar — not a flat eight), the balance lines,
 * and anything that would stop the request being sent; this component
 * renders that answer. **Send request** is disabled while there is a
 * blocker; **Save as draft** never is — a draft holds nothing and tells
 * nobody.
 *
 * Recording for someone else is the same form with a person picker, dates
 * that may be in the past, and one button. Limits the person is over are
 * shown as warnings and do not stop the save (decided 2026-11-05).
 *
 * Remounted by the caller per opening, so it seeds fresh each time.
 */
export function RequestSheet({
  mode,
  policy,
  request,
  people = [],
  employeeId,
  noReviewer = false,
  onClose,
  onSaved,
}: RequestSheetProps) {
  const { user: viewer } = useAuth();
  const queryClient = useQueryClient();
  const today = agencyTodayYmd(viewer?.timeZone);
  const record = mode === "record";
  const intent = useRef<Intent>("send");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: ({ values, as }: { values: RequestFormValues; as: Intent }) => {
      if (record) return recordTimeOff(toRecordInput(values));
      const input = toRequestInput(values);
      if (request) {
        return as === "send"
          ? submitTimeOffRequest(request.id, input)
          : updateTimeOffRequest(request.id, input);
      }
      return createTimeOffRequest({ ...input, send: as === "send" });
    },
    onSuccess: async (saved, { as }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: timeOffKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["people"] }),
      ]);
      toast.success(
        record
          ? "Time off recorded."
          : as === "draft"
            ? "Draft saved."
            : saved.status === "approved"
              ? "Approved automatically."
              : "Request sent.",
      );
      onSaved?.(saved);
      onClose();
    },
    onError: (failure) =>
      setError(failure instanceof ApiError ? failure.message : "Could not save. Try again."),
  });

  // Recording from a profile: the person is fixed, and so is the policy
  // when they are in only one.
  const fixedPerson = employeeId ? people.find((entry) => entry.id === employeeId) : undefined;
  const form = useAppForm({
    defaultValues: requestFormDefaults({
      policyId:
        policy?.id ??
        (fixedPerson?.policies.length === 1 ? fixedPerson.policies[0].id : undefined),
      employeeId,
      request,
    }),
    validators: { onBlur: requestFormSchema(today, mode) },
    onSubmit: ({ value }) => {
      setError(null);
      save.mutate({ values: value, as: intent.current });
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const { preview, pending, error: previewError } = useRequestPreview(
    values,
    mode,
    request?.id,
  );

  const person = people.find((entry) => entry.id === values.employeeId);
  const policyOptions = useMemo(
    () => (person?.policies ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
    [person],
  );
  const policyName = record
    ? null
    : (request?.policy?.name ?? policy?.name ?? "Time off");

  const blocked = (preview?.blockers.length ?? 0) > 0;
  const ready = previewable(values, mode);
  const submit = (as: Intent) => {
    intent.current = as;
    void form.handleSubmit();
  };

  return (
    <PersonSheet
      eyebrow={record ? "Time off" : (policyName ?? "Time off")}
      title={
        record
          ? "Record time off"
          : request
            ? `Edit request ${request.reference ?? ""}`.trim()
            : "Request time off"
      }
      onClose={onClose}
    >
      <form.AppForm>
        <form
          className="flex flex-1 flex-col gap-5 px-6 py-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit("send");
          }}
        >
          {record && (
            <FormGrid>
              <form.AppField name="employeeId">
                {(f) => (
                  <f.ComboboxField
                    label="Employee"
                    placeholder="Choose a person"
                    searchPlaceholder="Search people…"
                    emptyText="Nobody matches."
                    disabled={Boolean(employeeId)}
                    options={people.map((entry) => ({
                      value: entry.id,
                      label: entry.name,
                      keywords: entry.branchName ? [entry.branchName] : [],
                    }))}
                    onChanged={(id) => {
                      // The policy belongs to the person: start over with theirs.
                      const next = people.find((entry) => entry.id === id)?.policies ?? [];
                      form.setFieldValue("policyId", next.length === 1 ? next[0].id : "");
                    }}
                  />
                )}
              </form.AppField>
              <form.AppField name="policyId">
                {(f) => (
                  <f.SelectField
                    label="Policy"
                    placeholder={person ? "Choose a policy" : "Choose a person first"}
                    disabled={!person || policyOptions.length === 0}
                    options={policyOptions}
                    description={
                      person && policyOptions.length === 0
                        ? `${person.name} is not in a time off policy yet.`
                        : undefined
                    }
                  />
                )}
              </form.AppField>
            </FormGrid>
          )}

          <FormGrid>
            <form.AppField name="firstDay">
              {(f) => (
                <f.TextField
                  label="First day"
                  type="date"
                  min={record ? undefined : today}
                  onBlur={() => {
                    // A single day is a range of one.
                    const { firstDay, lastDay } = form.state.values;
                    if (firstDay && (!lastDay || lastDay < firstDay)) {
                      form.setFieldValue("lastDay", firstDay);
                      // The blur that got here judged an empty last day; ask
                      // again now that it has one. (The return is unreliable
                      // on a mounted field — the error state is what matters.)
                      void form.validateField("lastDay", "blur");
                    }
                  }}
                />
              )}
            </form.AppField>
            <form.AppField name="lastDay">
              {(f) => (
                <f.TextField
                  label="Last day"
                  type="date"
                  min={values.firstDay || (record ? undefined : today)}
                />
              )}
            </form.AppField>
          </FormGrid>

          <form.AppField name="dayMode">
            {(f) => (
              <f.RadioGroupField
                label="Time requested"
                options={[
                  {
                    value: "full",
                    label: TIME_OFF_DAY_MODE_LABELS.full,
                    caption: "Every working day in the range, for its scheduled hours.",
                  },
                  {
                    value: "partial",
                    label: TIME_OFF_DAY_MODE_LABELS.partial,
                    caption: "Enter the hours for each date.",
                  },
                ]}
              />
            )}
          </form.AppField>

          {preview && preview.days.length > 0 && (
            <section aria-label="Hours per date" className="rounded-lg border border-border">
              <ul>
                {preview.days.map((day, index) => (
                  <li
                    key={day.date}
                    className={
                      index < preview.days.length - 1
                        ? "flex items-center gap-3 border-b border-border px-4 py-2.5"
                        : "flex items-center gap-3 px-4 py-2.5"
                    }
                  >
                    <DayLabel day={day} />
                    {values.dayMode === "partial" && day.scheduledHours > 0 ? (
                      <form.AppField name={`hours.${day.date}`}>
                        {(f) => (
                          <f.NumberField
                            className="w-28"
                            step="0.25"
                            min="0"
                            max={String(day.scheduledHours)}
                            placeholder={String(day.scheduledHours)}
                          />
                        )}
                      </form.AppField>
                    ) : (
                      <span
                        className={
                          day.hours > 0
                            ? "text-sm font-medium tabular-nums text-foreground"
                            : "text-sm tabular-nums text-muted-foreground"
                        }
                      >
                        {formatBalance(day.hours)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="flex items-center justify-between border-t border-border bg-sunken px-4 py-2.5 text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatBalance(preview.totalHours)}
                </span>
              </p>
            </section>
          )}

          {preview && <BalanceBreakdown balance={preview.balance} projection={preview.projection} />}

          <Checks preview={preview} />

          {previewError && ready && !preview && (
            <FormError>
              {previewError instanceof ApiError
                ? previewError.message
                : "Could not work out the hours. Try again."}
            </FormError>
          )}

          <form.AppField name="note">
            {(f) => (
              <f.TextareaField
                label={record ? "Note for the employee" : "Note for the reviewer"}
                description="Optional."
                rows={3}
              />
            )}
          </form.AppField>

          {!record && noReviewer && (
            <Alert>
              <Info />
              <AlertDescription>
                Nobody else can review your requests yet, so this one will wait until a reviewer
                is added — unless the policy approves it automatically.
              </AlertDescription>
            </Alert>
          )}

          <FormError>{error}</FormError>

          <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            {!record && (
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending || !ready}
                onClick={() => submit("draft")}
              >
                {request?.status === "changes_requested" ? "Save changes" : "Save as draft"}
              </Button>
            )}
            <Button
              type="submit"
              variant="brand"
              disabled={save.isPending || !ready || pending || !preview || blocked}
            >
              {save.isPending
                ? "Saving…"
                : record
                  ? "Record time off"
                  : request?.status === "changes_requested"
                    ? "Send again"
                    : "Send request"}
            </Button>
          </div>
        </form>
      </form.AppForm>
    </PersonSheet>
  );
}

/** A date of the range: the day, and why it takes no hours when it takes none. */
function DayLabel({ day }: { day: TimeOffRequestDay }) {
  const reason = DAY_REASON_LABEL[day.reason];
  return (
    <div className="min-w-0 flex-1">
      <p className={day.scheduledHours > 0 ? "text-sm text-foreground" : "text-sm text-muted-foreground"}>
        {formatDay(day.date)}
      </p>
      <p className="text-xs text-muted-foreground">
        {reason || `Scheduled ${formatBalance(day.scheduledHours)}`}
      </p>
    </div>
  );
}

/** What stops the request (a blocker) and what it goes over anyway (a warning). */
function Checks({ preview }: { preview: TimeOffPreview | undefined }) {
  if (!preview) return null;
  return (
    <>
      {preview.blockers.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            <ul className="grid gap-1">
              {preview.blockers.map((check) => (
                <li key={check.code}>{check.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {preview.warnings.length > 0 && (
        <Alert>
          <Info />
          <AlertDescription>
            <ul className="grid gap-1">
              {preview.warnings.map((check) => (
                <li key={check.code}>{check.message}</li>
              ))}
            </ul>
            <p className="mt-1 text-muted-foreground">It can still be recorded.</p>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
