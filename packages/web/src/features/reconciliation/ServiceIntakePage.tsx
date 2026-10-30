import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AMBIGUOUS_HOUSEHOLD_CODE,
  canSetUpReconciliationService,
  CONTACT_DECEASED_CODE,
  RECONCILIATION_HOUSEHOLD_NOT_VISIBLE,
  ModuleKey,
  POLICY_TYPES,
  reconciliationOutcomeKinds,
  type AmbiguousHouseholdCandidate,
  type ReconciliationAssignedRowDetail,
  type ServiceTicketAssignee,
} from "@sfa/shared";
import { AddressFields } from "@/components/address/AddressFields";
import { DataRow } from "@/components/common/DetailCard";
import {
  pinOption,
  SearchableSelect,
} from "@/components/common/SearchableSelect";
import { SEARCH_DEBOUNCE_MS } from "@/components/common/TableSearchInput";
import { FormError, FormGrid, FormSection } from "@/components/form";
import { useFieldError } from "@/components/form/fields";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import { leadIntakeFromHousehold } from "@/features/household/components/start-quote-prefill";
import {
  HouseholdMembersShell,
  MemberRowGroup,
  emptyMember,
} from "@/features/lead/components/HouseholdMembersField";
import { PrimaryContactFields } from "@/features/lead/components/PrimaryContactFields";
import { SoldDocumentUpload } from "@/features/sold/components/SoldDocumentUpload";
import { useAppForm } from "@/hooks/form";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePermissions } from "@/hooks/usePermissions";
import { ApiError, getStoredUser } from "@/lib/api-client";
import {
  getServiceIntakeOptions,
  reconciliationAssignedRowKey,
  reconciliationKey,
  reconciliationServiceIntakeOptionsKey,
  submitServiceIntake,
} from "@/lib/carrier-reconciliation-api";
import { agencyTodayYmd } from "@/lib/dates";
import { getHousehold, searchHouseholds } from "@/lib/households-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { ALLOWED_NBA_UPLOAD_TYPES } from "@/lib/sold-deals-api";
import {
  apiErrorCode,
  apiErrorMessage,
  apiErrorStatus,
  formatDay,
  formatPremium,
} from "./reconciliation-format";
import {
  dashClient,
  makeServiceIntakeSchema,
  serviceIntakeDefaults,
  toServiceIntakeInput,
  type ServiceIntakeFormValues,
} from "./service-intake-schema";
import { useHeldAssignedRow } from "./useHeldAssignedRow";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** The client fields a picked household fills, re-judged after it does. */
const CLIENT_FIELD_PATHS = [
  "primaryContact.firstName",
  "primaryContact.lastName",
  "primaryContact.dateOfBirth",
  "primaryContact.phone",
  "primaryContact.email",
  "address.street",
  "address.city",
  "address.state",
  "address.zip",
  "members",
] as const;

/**
 * `/reconciliation/assigned/:rowId/service-intake` — **Set up for service**
 * (PAC-173 PR 5): the assignee of a 1-800 Dash row turns it into a serviced
 * client and hands it to a CSR's welcome call.
 *
 * Allstate sold the policy directly (its 1-800 line or allstate.com) and
 * assigned it to the agency. It is never a sale: this records **no lead and no
 * deal**, so nothing is credited to anyone. It records:
 *
 * 1. **The client**, captured as the New Lead form captures a household — the
 *    same cards (primary contact with DOB, phone and email; living address;
 *    members), seeded with Dash's customer name. "Existing client?" finds the
 *    household instead, and fills the cards from it as Start Quote does.
 * 2. **The policy**, filled in from Dash to confirm, with its signed new
 *    business application (required, a PDF, uploaded under the row).
 * 3. **The hand-off**: whose welcome call it is — the ticket picker's pool —
 *    and what the call opens with.
 *
 * One submit creates all of it and finishes the row, then lands on the
 * client's page. A row this page cannot act on — not the caller's, decided,
 * not a 1-800 policy the app lacks, CRM service off — says so instead.
 */
export default function ServiceIntakePage() {
  const { rowId: rawRowId = "" } = useParams();
  const rowId = OBJECT_ID.test(rawRowId) ? rawRowId : "";
  const { user } = useAuth();
  const { permissions } = usePermissions();
  const canService = canSetUpReconciliationService([...permissions]);
  const backTo = rowId
    ? `/reconciliation/assigned?row=${rowId}`
    : "/reconciliation/assigned";

  const held = useHeldAssignedRow(rowId, Boolean(rowId));
  const row = held.row;

  const offers = !!row && reconciliationOutcomeKinds(row).includes("service_intake");
  const isMine = !!row && !!user && row.assignment?.user.id === user.id;
  const open = !!row && row.needsReview && row.review.status === "open";
  const ready =
    !!row &&
    isMine &&
    open &&
    offers &&
    canService &&
    !!row.prefill?.serviceIntake &&
    !row.outcome;

  const optionsQuery = useQuery({
    queryKey: reconciliationServiceIntakeOptionsKey(rowId),
    queryFn: () => getServiceIntakeOptions(rowId),
    enabled: ready,
    retry: false,
  });

  const blocked = blockedReason(row, {
    rowId,
    gone: held.gone,
    error: held.error,
    isMine,
    open,
    offers,
    canService,
  });

  return (
    <AppShell>
      <header className="flex items-center gap-2 border-b border-border px-4 py-4 md:gap-3 md:px-6">
        <MobileNav className="-ml-1" />
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-foreground"
        >
          <Link to={backTo} aria-label="Back to the Dash row">
            <ArrowLeft size={16} />
          </Link>
        </Button>
        <div>
          <h1 className="text-sm font-bold">Set up for service</h1>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            1-800 policy from Dash
          </p>
        </div>
      </header>

      <main className="px-4 md:px-6 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {row?.dash && !blocked && (
            <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              Dash line {row.dash.rowNumber}:{" "}
              <span className="text-foreground">
                {row.dash.customerName ?? NOT_AVAILABLE}
              </span>{" "}
              · {row.dash.productDescription ?? row.dash.product ?? NOT_AVAILABLE}{" "}
              · policy {row.dash.policyNumber ?? NOT_AVAILABLE} · bound by{" "}
              {row.dash.bindId ?? NOT_AVAILABLE} on{" "}
              {formatDay(row.dash.dateWritten)} ·{" "}
              {formatPremium(row.dash.writtenPremium)}. Allstate sold it; the
              agency services it. This records the client and the policy — no
              lead, no sale — and opens a CSR's welcome call.
            </p>
          )}

          {held.loading || (ready && optionsQuery.isPending) ? (
            <Panel>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                Loading the Dash line…
              </p>
            </Panel>
          ) : blocked ? (
            <Panel>
              <p className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                <AlertCircle size={16} className="text-destructive" />
                {blocked.title}
              </p>
              <p className="text-sm text-muted-foreground">{blocked.detail}</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to={backTo}>Back to the Dash row</Link>
                </Button>
                {blocked.householdId && (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/clients/${blocked.householdId}`}>
                      Open household
                    </Link>
                  </Button>
                )}
              </div>
            </Panel>
          ) : row && optionsQuery.data ? (
            // Once the CSR list is in, the form stays: a background refetch
            // that fails must not take a half-filled form away.
            optionsQuery.data.assignees.length > 0 ? (
              <ServiceIntakeForm
                key={row.id}
                row={row}
                assignees={optionsQuery.data.assignees}
                backTo={backTo}
              />
            ) : (
              <Panel>
                <p className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                  <AlertCircle size={16} className="text-destructive" />
                  There's no CSR to hand the welcome call to.
                </p>
                <p className="text-sm text-muted-foreground">
                  The call goes to an active CSR or CRM in your branch, and
                  there is none. Ask the owner to give someone that role, or to
                  reassign the row.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link to={backTo}>Back to the Dash row</Link>
                </Button>
              </Panel>
            )
          ) : optionsQuery.isError ? (
            <Panel>
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle size={16} />
                Couldn't load the CSRs this can go to.
              </p>
              <p className="text-sm text-muted-foreground">
                {apiErrorMessage(optionsQuery.error, "Try again in a moment.")}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void optionsQuery.refetch()}
              >
                Try again
              </Button>
            </Panel>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}

/** Why the page cannot take this row, or `null` when it can. */
function blockedReason(
  row: ReconciliationAssignedRowDetail | null,
  state: {
    rowId: string;
    gone: boolean;
    error: Error | null;
    isMine: boolean;
    open: boolean;
    offers: boolean;
    canService: boolean;
  },
): { title: string; detail: string; householdId?: string } | null {
  if (!state.rowId) {
    return {
      title: "That isn't a Dash row.",
      detail: "Open the row from your list of Dash follow-ups.",
    };
  }
  if (state.gone) {
    return {
      title: "This Dash row is no longer assigned to you.",
      detail: "The owner reassigned it or took it back.",
    };
  }
  if (state.error) {
    return { title: "Couldn't load the Dash row.", detail: state.error.message };
  }
  if (!row) return null;
  const outcome = row.outcome;
  if (outcome?.kind === "service_intake" && outcome.status === "done") {
    return {
      title: "This policy is already set up for service.",
      detail: "Its client, policy and welcome call are in the app.",
      householdId: outcome.householdId ?? undefined,
    };
  }
  if (!state.isMine) {
    return {
      title: "Only the row's assignee sets it up for service.",
      detail: row.assignment
        ? `It is assigned to ${row.assignment.user.name}.`
        : "Nobody has been given it yet.",
    };
  }
  if (!state.open) {
    return {
      title: "This row has already been decided.",
      detail: "Open it to see where it stands.",
    };
  }
  if (!state.offers) {
    return {
      title: "This row can't be set up for service.",
      detail:
        "Only a 1-800 policy the app does not have yet can. Record what became of this one from the row instead.",
    };
  }
  if (!state.canService) {
    return {
      title: "You can't set policies up for service.",
      detail:
        "It takes permission to add leads. Ask the owner to reassign the row.",
    };
  }
  if (!row.prefill?.serviceIntake) {
    return {
      title: "CRM service is off for this agency.",
      detail:
        "Setting a policy up for service opens a CSR's welcome call, which needs CRM service. Record Other on the row, or ask the owner to turn it on.",
    };
  }
  if (outcome?.kind === "service_intake") {
    return {
      title: "The client and the policy are already saved.",
      detail:
        "The welcome call didn't open. Open it from the row — that finishes it.",
      householdId: outcome.householdId ?? undefined,
    };
  }
  if (outcome) {
    return {
      title: "This row is already being recorded another way.",
      detail: "Open it to see where it stands.",
    };
  }
  return null;
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-6">
      {children}
    </div>
  );
}

/**
 * The form itself, mounted once the row and the CSR pool are in —
 * `useAppForm`'s defaults are read on mount, not after.
 */
function ServiceIntakeForm({
  row,
  assignees,
  backTo,
}: {
  row: ReconciliationAssignedRowDetail;
  assignees: ServiceTicketAssignee[];
  backTo: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { canAny } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  /** The households a client belongs to, when the API asks which one this is for. */
  const [candidates, setCandidates] = useState<AmbiguousHouseholdCandidate[]>(
    [],
  );
  /** The household the policy goes on; `filled` when the cards came from it. */
  const [client, setClient] = useState<{
    id: string;
    label: string;
    filled: boolean;
  } | null>(null);
  const [loadingClient, setLoadingClient] = useState(false);

  const today = agencyTodayYmd(getStoredUser()?.timeZone);
  const schema = useMemo(() => makeServiceIntakeSchema(today), [today]);
  const defaultCsrId = assignees.some((person) => person.id === user?.id)
    ? (user?.id ?? "")
    : "";

  const submit = useMutation({
    mutationFn: (values: ServiceIntakeFormValues) =>
      submitServiceIntake(row.id, toServiceIntakeInput(values, client?.id ?? null)),
    onSuccess: (result, values) => {
      if (result.row) {
        queryClient.setQueryData(reconciliationAssignedRowKey(row.id), result.row);
      }
      void queryClient.invalidateQueries({ queryKey: reconciliationKey });
      void queryClient.invalidateQueries({ queryKey: ["households"] });
      void queryClient.invalidateQueries({
        queryKey: ["household", result.householdId],
      });
      void queryClient.invalidateQueries({ queryKey: ["service-tickets"] });
      const csr = assignees.find((person) => person.id === values.assignedCsrId);
      if (result.ticketId) {
        toast.success(
          `Set up for service — welcome call opened for ${csr?.name ?? "the CSR"}.`,
        );
      } else if (!result.row) {
        // The owner took the row back meanwhile; whoever has it next — or the
        // owner — opens the call.
        toast.warning(
          "The client and the policy are saved. The row went back to the owner before the welcome call opened, so it will be opened from there.",
        );
      } else {
        toast.warning(
          "The client and the policy are saved, but the welcome call didn't open. Open it from the Dash row to finish.",
        );
      }
      navigate(`/clients/${result.householdId}`, { replace: true });
    },
    onError: (failure) => {
      const message = apiErrorMessage(
        failure,
        "The policy could not be set up for service.",
      );
      const code = apiErrorCode(failure);
      // Answers the form can act on — which of the client's households this
      // is for, or a client on file who has died — keep what was typed.
      if (code === AMBIGUOUS_HOUSEHOLD_CODE) {
        const body = failure instanceof ApiError ? failure.body : null;
        setCandidates(
          (body as { households?: AmbiguousHouseholdCandidate[] } | null)
            ?.households ?? [],
        );
        setError(
          "This person belongs to more than one household. Pick the one this policy is for, then set it up again.",
        );
        return;
      }
      if (code === CONTACT_DECEASED_CODE) {
        setError(message);
        return;
      }
      // A household this caller cannot add a policy to: drop the pin, keep
      // what was typed — but not cards filled from that household — and say why.
      if (code === RECONCILIATION_HOUSEHOLD_NOT_VISIBLE) {
        void pickClient(null);
        setError(message);
        return;
      }
      // Decided, reassigned or set up since this page opened: the row says
      // where it stands now.
      if (apiErrorStatus(failure) === 404 || apiErrorStatus(failure) === 409) {
        toast.error(message);
        void queryClient.invalidateQueries({ queryKey: reconciliationKey });
        navigate(backTo, { replace: true });
        return;
      }
      setError(message);
    },
  });

  const form = useAppForm({
    defaultValues: serviceIntakeDefaults(row, defaultCsrId),
    validators: { onBlur: schema, onSubmit: schema },
    onSubmit: ({ value }) => {
      setError(null);
      setCandidates([]);
      submit.mutate(value);
    },
  });

  /**
   * Re-judge the client fields after they were filled programmatically, or
   * forget what was said about them when they are put back to the Dash line —
   * otherwise an error from before stays under a field that is now right.
   */
  const refreshClientFields = (validate: boolean) => {
    for (const path of CLIENT_FIELD_PATHS) {
      if (validate) {
        void form.validateField(path, "blur");
      } else {
        form.setFieldMeta(path, (meta) =>
          meta
            ? { ...meta, isTouched: false, isBlurred: false, errorMap: {} }
            : meta,
        );
      }
    }
  };

  /**
   * Add the policy to an existing household. From the search, the cards are
   * filled from it, as Start Quote does; from the "which household?" answer
   * (`fill: false`) the household is only pinned — the person typed is the
   * one the policy is for, and may not be its primary.
   */
  const pickClient = async (
    picked: { id: string; label: string } | null,
    { fill = true }: { fill?: boolean } = {},
  ) => {
    const previous = client;
    setClient(picked ? { ...picked, filled: fill } : null);
    setCandidates([]);
    if (!picked) {
      // Undo a fill; a household that was only pinned changed nothing typed.
      if (!previous?.filled) return;
      const blank = dashClient(row);
      form.setFieldValue("primaryContact", blank.primaryContact);
      form.setFieldValue("address", blank.address);
      form.setFieldValue("members", blank.members);
      refreshClientFields(false);
      return;
    }
    if (!fill) return;
    setLoadingClient(true);
    try {
      const household = await queryClient.fetchQuery({
        queryKey: ["household", picked.id],
        queryFn: () => getHousehold(picked.id),
      });
      const seeded = leadIntakeFromHousehold(household);
      form.setFieldValue("primaryContact", seeded.primaryContact);
      form.setFieldValue("address", seeded.address);
      form.setFieldValue("members", seeded.members);
      refreshClientFields(true);
      // Each member row too — a submit error under a row the fill just
      // completed would otherwise stay.
      seeded.members.forEach((_, index) => {
        for (const key of ["firstName", "lastName", "dateOfBirth", "role"] as const) {
          void form.validateField(`members[${index}].${key}`, "blur");
        }
      });
    } catch (failure) {
      toast.error(apiErrorMessage(failure, "Couldn't load that client."));
      // Nothing was filled: the cards still say what they said, so does the pin.
      setClient(previous);
    } finally {
      setLoadingClient(false);
    }
  };

  const canSearchClients = canAny([
    `${ModuleKey.Clients}:read`,
    `${ModuleKey.CrmService}:read`,
  ]);
  const csrOptions = assignees.map((person) => ({
    value: person.id,
    label: person.name,
    keywords: [person.email],
  }));
  const carrier = row.prefill?.policy.carrier ?? "Allstate";

  return (
    <form.AppForm>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FormSection
          title="Client"
          description="Who the policy is for, captured as a lead's household is — no lead is made."
        >
          {canSearchClients && (
            <ExistingClientPicker
              client={client}
              disabled={loadingClient || submit.isPending}
              onPick={(picked) => void pickClient(picked)}
            />
          )}
          <PrimaryContactFields form={form} fields="primaryContact" />
        </FormSection>

        <FormSection
          title="Living address"
          description="Where the household lives."
        >
          <AddressFields
            form={form}
            fields="address"
            inputClassName="bg-card border-border"
          />
        </FormSection>

        <FormSection
          title="Household members"
          description="Anyone else on the policy or in the household."
        >
          <form.Field name="members" mode="array">
            {(field) => (
              <HouseholdMembersShell
                count={field.state.value.length}
                onAdd={() => field.pushValue(emptyMember())}
              >
                {field.state.value.map((_, i) => (
                  <MemberRowGroup
                    key={i}
                    form={form}
                    fields={`members[${i}]`}
                    index={i}
                    onRemove={() => field.removeValue(i)}
                  />
                ))}
              </HouseholdMembersShell>
            )}
          </form.Field>
        </FormSection>

        <FormSection
          title="Policy"
          description="From Dash — check it against the application."
        >
          <FormGrid>
            <form.AppField name="policy.policyNumber">
              {(f) => (
                <f.TextField
                  label="Policy number"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="policy.policyType">
              {(f) => (
                <f.SelectField
                  label="Policy type"
                  options={POLICY_TYPES}
                  placeholder="Pick the type"
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="policy.premium">
              {(f) => (
                <f.NumberField
                  label="Written premium"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="policy.itemCount">
              {(f) => (
                <f.NumberField
                  label="Items"
                  inputMode="numeric"
                  step="1"
                  min="1"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="policy.effectiveDate">
              {(f) => (
                <f.TextField
                  label="Effective date"
                  type="date"
                  inputClassName="bg-card border-border"
                />
              )}
            </form.AppField>
            <DataRow label="Carrier" value={carrier} />
          </FormGrid>
          <div className="space-y-2">
            <Label>New business application</Label>
            <form.Field name="policy.newBusinessApplication">
              {(field) => (
                <SoldDocumentUpload
                  uploadScope={{ kind: "reconciliation", rowId: row.id }}
                  kind="new_business_application"
                  accept={ALLOWED_NBA_UPLOAD_TYPES}
                  hint="The signed application. PDF up to 10MB"
                  value={field.state.value}
                  onChange={(meta) => {
                    field.handleChange(meta);
                    field.handleBlur();
                  }}
                  ariaLabel="Upload the new business application"
                  error={useFieldError(field.state.meta)}
                />
              )}
            </form.Field>
          </div>
        </FormSection>

        <FormSection
          title="Hand-off"
          description="Whose welcome call it is. The call opens on their desk as soon as you save, and the household is theirs unless it already has a CSR."
        >
          <form.AppField name="assignedCsrId">
            {(f) => (
              <f.ComboboxField
                label="CSR"
                options={csrOptions}
                placeholder="Pick a CSR"
                searchPlaceholder="Name or email"
                emptyText="Nobody matches"
                triggerClassName="w-full bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="openingNote">
            {(f) => (
              <f.TextareaField
                label="Opening note"
                description="The first thing on the welcome call — where the client came from."
                rows={3}
                textareaClassName="bg-card border-border"
              />
            )}
          </form.AppField>
        </FormSection>

        <FormError>{error}</FormError>
        {candidates.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {candidates.map((candidate) => {
              const label =
                candidate.name ?? candidate.reference ?? "Unnamed household";
              return (
                <Button
                  key={candidate.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingClient || submit.isPending}
                  onClick={() => {
                    // The client picker above now names it, and says the
                    // policy goes there.
                    setError(null);
                    void pickClient(
                      { id: candidate.id, label },
                      { fill: false },
                    );
                  }}
                >
                  {label}
                  {candidate.address?.city ? ` · ${candidate.address.city}` : ""}
                </Button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button asChild type="button" variant="outline">
            <Link to={backTo}>Cancel</Link>
          </Button>
          <Button
            type="submit"
            variant="brand"
            disabled={submit.isPending || loadingClient}
            className="ml-auto active:scale-95"
          >
            {submit.isPending && <Loader2 aria-hidden className="animate-spin" />}
            {submit.isPending ? "Setting up…" : "Set up for service"}
          </Button>
        </div>
      </form>
    </form.AppForm>
  );
}

/**
 * "Existing client?" — the ticket dialog's household search. Picking one adds
 * the policy to that household and fills the cards from it; clearing it goes
 * back to the Dash line's name.
 */
function ExistingClientPicker({
  client,
  disabled,
  onPick,
}: {
  client: { id: string; label: string } | null;
  disabled: boolean;
  onPick: (client: { id: string; label: string } | null) => void;
}) {
  const [term, setTerm] = useState("");
  const q = useDebouncedValue(term, SEARCH_DEBOUNCE_MS);
  const search = useQuery({
    queryKey: ["households", "search", q],
    queryFn: () => searchHouseholds(q),
  });
  const options = pinOption(
    (search.data ?? []).map((household) => ({
      value: household.id,
      label:
        household.name ?? household.primaryContactName ?? "Unnamed household",
      hint: `${household.totalActivePolicies} active`,
    })),
    client?.id,
    client?.label,
  );

  return (
    <div className="space-y-1.5">
      <Label htmlFor="service-intake-client">Existing client?</Label>
      <SearchableSelect
        id="service-intake-client"
        options={options}
        value={client?.id ?? null}
        onChange={(value) => {
          const picked = options.find((option) => option.value === value);
          onPick(picked ? { id: picked.value, label: picked.label } : null);
        }}
        onSearch={setTerm}
        placeholder="New client — search to add it to an existing one"
        searchPlaceholder="Name, phone or email"
        emptyLabel="No clients found"
        loading={search.isFetching}
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">
        {client
          ? "The policy goes on this household. A phone or email that differs from the one on file is noted on the welcome call, not saved over it."
          : "Leave it empty for someone new to the agency."}
      </p>
    </div>
  );
}
