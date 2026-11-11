import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  agencyEventError,
  type AgencyEventImpact,
  type AgencyEventView,
} from "@sfa/shared";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormError, FormGrid } from "@/components/form";
import { PersonSheet } from "@/features/people/sheets/PersonSheet";
import { formatRange } from "@/features/hr/policies/policy-display";
import { useAppForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import {
  createAgencyEvent,
  hrCalendarKeys,
  listEventAudienceOptions,
  previewAgencyEventImpact,
  removeAgencyEvent,
  updateAgencyEvent,
} from "@/lib/hr-calendar-api";
import { timeOffKeys } from "@/lib/time-off-api";
import { EVENT_EFFECT_META } from "./calendar-display";
import {
  eventFormDefaults,
  eventFormSchema,
  toEventInput,
  type EventFormValues,
} from "./event-form";

interface EventSheetProps {
  /** The event being changed; `null` for a new one. */
  event: AgencyEventView | null;
  /** The days picked on the grid, for a new event. */
  range?: { from: string; to: string };
  onClose: () => void;
}

/**
 * Add or change an agency event (PAC-169): a date the agency puts on its
 * calendar, what it does to time off, and who it is for.
 *
 * Saving an event changes **no time off request**. A "no time off" or "day
 * off" event applies to requests made from then on; the ones already sent
 * keep their hours. So the form shows, as it is filled in, the requests the
 * event would run into (`POST /hr/events/impact`, which writes nothing) —
 * the admin's list of people to talk to, not a list of things that will
 * happen.
 */
export function EventSheet({ event, range, onClose }: EventSheetProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const options = useQuery({
    queryKey: hrCalendarKeys.audienceOptions,
    queryFn: listEventAudienceOptions,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hrCalendarKeys.all }),
      // A request's conflict list and a new request's hours both read events.
      queryClient.invalidateQueries({ queryKey: timeOffKeys.all }),
    ]);

  const save = useMutation({
    mutationFn: (values: EventFormValues) => {
      const input = toEventInput(values);
      return event
        ? updateAgencyEvent(event.id, input)
        : createAgencyEvent(input);
    },
    onSuccess: async () => {
      await refresh();
      toast.success(event ? "Event updated." : "Event added.");
      onClose();
    },
    onError: (failure) =>
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Could not save. Try again.",
      ),
  });

  const remove = useMutation({
    mutationFn: () => removeAgencyEvent(event!.id),
    onSuccess: async () => {
      await refresh();
      toast.success("Event removed.");
      onClose();
    },
    onError: (failure) => {
      setRemoving(false);
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Could not remove. Try again.",
      );
    },
  });

  const form = useAppForm({
    defaultValues: eventFormDefaults(event, range),
    validators: { onBlur: eventFormSchema },
    onSubmit: ({ value }) => {
      setError(null);
      save.mutate(value);
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const impact = useEventImpact(values);

  return (
    <PersonSheet
      eyebrow="Calendar"
      title={event ? "Edit event" : "Add event"}
      onClose={onClose}
    >
      <form.AppForm>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="flex-1 space-y-5 px-6 py-5">
            <form.AppField name="name">
              {(f) => (
                <f.TextField label="Name" placeholder="Christmas party" />
              )}
            </form.AppField>

            <FormGrid>
              <form.AppField name="firstDay">
                {(f) => (
                  <f.TextField
                    label="First day"
                    type="date"
                    onBlur={() => {
                      // One day is a range of one.
                      const { firstDay, lastDay } = form.state.values;
                      if (firstDay && (!lastDay || lastDay < firstDay)) {
                        form.setFieldValue("lastDay", firstDay);
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
                    min={values.firstDay || undefined}
                  />
                )}
              </form.AppField>
            </FormGrid>

            <FormGrid>
              <form.AppField name="startTime">
                {(f) => (
                  <f.TextField
                    label="Start time"
                    type="time"
                    description="Optional. Shown on the calendar only."
                  />
                )}
              </form.AppField>
              <form.AppField name="endTime">
                {(f) => <f.TextField label="End time" type="time" />}
              </form.AppField>
            </FormGrid>

            <form.AppField name="effect">
              {(f) => (
                <f.RadioGroupField
                  label="Time off on these days"
                  options={(["none", "blackout", "day_off"] as const).map(
                    (effect) => ({
                      value: effect,
                      label: EVENT_EFFECT_META[effect].label,
                      caption: EVENT_EFFECT_META[effect].hint,
                    }),
                  )}
                />
              )}
            </form.AppField>

            <form.AppField name="audienceKind">
              {(f) => (
                <f.RadioGroupField
                  label="Who it is for"
                  options={[
                    {
                      value: "agency",
                      label: "Everyone",
                      caption: "The whole agency.",
                    },
                    {
                      value: "branches",
                      label: "Branches",
                      caption: "Everyone whose home branch is one you choose.",
                    },
                    {
                      value: "people",
                      label: "People",
                      caption: "Only the people you choose.",
                    },
                  ]}
                />
              )}
            </form.AppField>
            {values.audienceKind === "branches" && (
              <form.AppField name="branchIds">
                {(f) => (
                  <f.MultiSelectField
                    label="Branches"
                    placeholder="Choose branches"
                    summarize={(count) => `${count} branches`}
                    options={(options.data?.branches ?? []).map((branch) => ({
                      value: branch.id,
                      label: branch.name,
                    }))}
                  />
                )}
              </form.AppField>
            )}
            {values.audienceKind === "people" && (
              <form.AppField name="userIds">
                {(f) => (
                  <f.MultiSelectField
                    label="People"
                    placeholder="Choose people"
                    summarize={(count) => `${count} people`}
                    options={(options.data?.people ?? []).map((person) => ({
                      value: person.id,
                      label: person.name,
                    }))}
                  />
                )}
              </form.AppField>
            )}

            <form.AppField name="description">
              {(f) => (
                <f.TextareaField label="Description" placeholder="Optional" />
              )}
            </form.AppField>

            <EventImpact impact={impact} effect={values.effect} />
            <FormError>{error}</FormError>
          </div>

          <div className="flex items-center gap-2 border-t border-border px-6 py-4">
            {event && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive"
                disabled={save.isPending || remove.isPending}
                onClick={() => setRemoving(true)}
              >
                <Trash2 />
                Remove
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className={event ? undefined : "ml-auto"}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={save.isPending}>
              {save.isPending
                ? "Saving…"
                : event
                  ? "Save changes"
                  : "Add event"}
            </Button>
          </div>
        </form>
      </form.AppForm>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this event?</AlertDialogTitle>
            <AlertDialogDescription>
              It comes off the calendar and stops affecting new time off
              requests. Requests already sent keep the hours they have now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending ? "Removing…" : "Remove event"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PersonSheet>
  );
}

/**
 * The requests the event as typed would run into, a moment after typing
 * stops. Asked only while the event would do something and is valid; the
 * last answer stays on screen while the next one loads.
 */
function useEventImpact(values: EventFormValues): AgencyEventImpact | null {
  const [settled, setSettled] = useState(values);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(values), 300);
    return () => window.clearTimeout(timer);
  }, [values]);

  const input = toEventInput(settled);
  const askable = input.effect !== "none" && agencyEventError(input) === null;
  const impact = useQuery({
    queryKey: hrCalendarKeys.impact(input),
    queryFn: () => previewAgencyEventImpact(input),
    enabled: askable,
    placeholderData: keepPreviousData,
  });
  return askable ? (impact.data ?? null) : null;
}

function EventImpact({
  impact,
  effect,
}: {
  impact: AgencyEventImpact | null;
  effect: EventFormValues["effect"];
}) {
  if (!impact || effect === "none") return null;
  const total = impact.requests.length + impact.hiddenCount;
  if (total === 0) return null;
  return (
    <Alert>
      <AlertTriangle />
      <AlertDescription>
        <p className="font-medium text-foreground">
          {total === 1
            ? "1 time off request is on these days."
            : `${total} time off requests are on these days.`}
        </p>
        <p className="text-sm text-muted-foreground">
          {effect === "day_off"
            ? "They keep the hours they have now. Cancel or adjust the ones that should not be charged."
            : "Nothing changes for them. Talk to the people, or cancel the request, if they should not be off."}
        </p>
        {impact.requests.length > 0 && (
          <ul className="mt-2 space-y-1">
            {impact.requests.map((row) => (
              <li
                key={`${row.person.id}-${row.firstDay}`}
                className="text-sm text-foreground"
              >
                {row.requestId ? (
                  <Link
                    className="font-medium underline underline-offset-2"
                    to={`/time-off/requests/${row.requestId}`}
                  >
                    {row.person.name}
                  </Link>
                ) : (
                  <span className="font-medium">{row.person.name}</span>
                )}
                {" · "}
                {formatRange(row.firstDay, row.lastDay)}
                {" · "}
                {row.status === "approved" ? "Approved" : "Pending"}
                {" · "}
                {row.hours} h
              </li>
            ))}
          </ul>
        )}
        {impact.hiddenCount > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            {impact.hiddenCount === 1
              ? "1 more is in a branch you do not manage."
              : `${impact.hiddenCount} more are in branches you do not manage.`}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
