import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  ANY_CARRIER,
  leadSourceRuleCarrierLabel,
  PAYMENT_STRUCTURE_NAME_TAKEN,
  PAYMENT_STRUCTURE_STALE,
  rateRuleCarrierLabel,
  type CarrierOption,
  type LeadSourceOption,
  type PaymentStructureView,
  type PayoutPersonView,
} from "@sfa/shared";
import { DetailCard } from "@/components/common/DetailCard";
import { StepProgress } from "@/components/common/StepProgress";
import { WizardFooter } from "@/components/common/WizardFooter";
import { FormError } from "@/components/form";
import type { ChecklistOption, ComboboxOption } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppForm } from "@/hooks/form";
import { useLeadSources } from "@/hooks/useLeadSources";
import { carriersKey, getCarriers } from "@/lib/carriers-api";
import { ownsPath } from "@/lib/field-paths";
import { NOT_AVAILABLE } from "@/lib/not-available";
import {
  createPaymentStructure,
  getPaymentStructure,
  listPayoutPeople,
  paymentStructureKey,
  payoutPeopleKey,
  payoutsKey,
  updatePaymentStructure,
} from "@/lib/payouts-api";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { payoutErrorCode, payoutErrorMessage } from "../payout-errors";
import {
  newStructureValues,
  STRUCTURE_STEPS,
  structureFormSchema,
  structureValuesFrom,
  toStructureInput,
  type StructureFormValues,
  type StructureStep,
} from "./structure-form";
import { BonusesStep, PeopleStep, RatesStep } from "./structure-steps";

/**
 * Settings → Payouts → a payment structure, new or existing (PAC-177).
 *
 * Three steps — rates, bonuses, people — rules first and people last, the
 * shape David liked in Gusto. Nothing is written until the last step's save;
 * an existing structure can also be saved from any step.
 */
export default function StructureEditorPage() {
  const { id } = useParams<{ id: string }>();
  // Keyed by id so every structure gets fresh queries — "fetched after
  // mount" below must mean after *this* structure's page opened, and React
  // Router reuses the component when only `:id` changes.
  return <StructureEditorRoute key={id ?? "new"} id={id ?? null} />;
}

function StructureEditorRoute({ id }: { id: string | null }) {
  const editing = id !== null;

  /*
   * The form is seeded once, so it must be seeded from a copy fetched on
   * this visit — never a cached one. Saving structure B can move people off
   * A, and an editor seeded from A's cached copy would show them still
   * ticked and save them straight back. Both queries refetch on mount and
   * the page waits for that fetch; nothing refetches in the background
   * mid-edit (it would be ignored anyway). Changes made elsewhere *after*
   * this load are caught by the API's `expectedUpdatedAt` check.
   */
  const structure = useQuery({
    queryKey: paymentStructureKey(id ?? "new"),
    queryFn: () => getPaymentStructure(id!),
    enabled: editing,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const carriers = useQuery({
    queryKey: carriersKey,
    queryFn: getCarriers,
    staleTime: 10 * 60_000,
  });
  const people = useQuery({
    queryKey: payoutPeopleKey,
    queryFn: listPayoutPeople,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  /*
   * Reference data, like the carriers: a cached list is fine, since the API
   * checks every source a save names. A failure does not block the editor —
   * stored rules still render (named from the structure itself) and only
   * adding a new one is disabled.
   */
  const leadSources = useLeadSources();
  /** True while a stale-save "Reload" refetches; the editor remounts after. */
  const [reloading, setReloading] = useState(false);

  const structureFresh = !editing || structure.isFetchedAfterMount;
  const peopleFresh = people.isFetchedAfterMount;
  const pending =
    !structureFresh ||
    !peopleFresh ||
    carriers.isPending ||
    leadSources.isPending ||
    reloading;
  const failed =
    (editing && structureFresh && structure.error) ||
    (peopleFresh && people.error) ||
    carriers.error ||
    null;

  const reload = async () => {
    setReloading(true);
    try {
      await Promise.all([
        editing ? structure.refetch() : null,
        people.refetch(),
      ]);
    } finally {
      setReloading(false);
    }
  };

  return (
    <SettingsPage
      title={
        editing
          ? (structure.data?.name ?? "Payment structure")
          : "New payment structure"
      }
      caption="How the people on it are paid"
      icon={Banknote}
      backTo="/settings/payouts"
    >
      {failed ? (
        <p className="text-sm text-destructive">{payoutErrorMessage(failed)}</p>
      ) : pending ? (
        // The editor unmounts here, so a reload re-seeds it from scratch —
        // `reset` does not redraw array fields (see the spike findings).
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : structure.data?.status === "archived" ? (
        <ArchivedNotice structure={structure.data} />
      ) : (
        <StructureEditor
          structure={structure.data ?? null}
          carriers={carriers.data ?? []}
          leadSources={leadSources.data ?? []}
          leadSourcesUnavailable={leadSources.isError}
          people={people.data?.people ?? []}
          onReload={() => void reload()}
        />
      )}
    </SettingsPage>
  );
}

/** An archived structure is history: shown as such, never as a form. */
function ArchivedNotice({ structure }: { structure: PaymentStructureView }) {
  return (
    <DetailCard
      title="This structure is archived"
      subheading={
        <p className="pt-1 text-sm text-muted-foreground">
          An archived structure can't be edited.
        </p>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {structure.name} was archived and its people were released. Statements
          already drafted keep the rates they were made with. To pay people this
          way again, create a new structure.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/payouts">Back to Payouts</Link>
        </Button>
      </div>
    </DetailCard>
  );
}

/** A failed save, and whether it failed because the copy was stale. */
interface SubmitError {
  message: string;
  stale: boolean;
}

function StructureEditor({
  structure,
  carriers,
  leadSources,
  leadSourcesUnavailable,
  people,
  onReload,
}: {
  structure: PaymentStructureView | null;
  carriers: readonly CarrierOption[];
  leadSources: readonly LeadSourceOption[];
  leadSourcesUnavailable: boolean;
  people: readonly PayoutPersonView[];
  onReload: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stepIndex, setStepIndex] = useState(0);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [defaultValues] = useState<StructureFormValues>(() =>
    structure ? structureValuesFrom(structure) : newStructureValues(),
  );
  const step = STRUCTURE_STEPS[stepIndex];
  const atLastStep = stepIndex === STRUCTURE_STEPS.length - 1;

  const carrierOptions = useMemo(
    () => carrierOptionsFor(carriers, defaultValues),
    [carriers, defaultValues],
  );
  const leadSourceCarrierOptions = useMemo(
    () =>
      carrierOptions.map((option) =>
        option.value === ANY_CARRIER
          ? { ...option, label: leadSourceRuleCarrierLabel(ANY_CARRIER) }
          : option,
      ),
    [carrierOptions],
  );
  const leadSourceOptions = useMemo(
    () => leadSourceOptionsFor(leadSources, structure),
    [leadSources, structure],
  );
  const peopleOptions = useMemo(
    () => peopleOptionsFor(people, structure),
    [people, structure],
  );

  const save = useMutation({
    mutationFn: (values: StructureFormValues) => {
      const input = toStructureInput(values);
      return structure
        ? updatePaymentStructure(structure.id, {
            ...input,
            // The version this form was seeded from: a save elsewhere since
            // is a 409 rather than a silent overwrite.
            expectedUpdatedAt: structure.updatedAt,
          })
        : createPaymentStructure(input);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: payoutsKey });
      toast.success(
        structure ? `${saved.name} saved.` : `${saved.name} created.`,
      );
      navigate("/settings/payouts");
    },
    onError: (error) => {
      const code = payoutErrorCode(error);
      setSubmitError({
        message: payoutErrorMessage(error),
        stale: code === PAYMENT_STRUCTURE_STALE,
      });
      // A name clash is fixed on the first step, where the name is. Every
      // other refusal (archived, stale) is shown here, on the step it hit.
      if (code === PAYMENT_STRUCTURE_NAME_TAKEN) goToStep(0);
    },
  });

  const form = useAppForm({
    defaultValues,
    validators: { onBlur: structureFormSchema },
    onSubmit: ({ value }) => {
      setSubmitError(null);
      save.mutate(value);
    },
  });

  const stepHasErrors = (target: StructureStep) =>
    Object.entries(form.state.fieldMeta).some(
      ([path, meta]) =>
        ownsPath(target.fields, path) && (meta?.errors.length ?? 0) > 0,
    );

  /** The onboarding wizard's step check — see `OnboardAgencyPage`. */
  const validateStep = async (target: StructureStep) => {
    const registered = Object.keys(form.state.fieldMeta) as Array<
      keyof typeof form.state.fieldMeta
    >;
    const paths = new Set([
      ...target.fields,
      ...registered.filter((path) => ownsPath(target.fields, String(path))),
    ]);
    await Promise.all([...paths].map((p) => form.validateField(p, "submit")));
    await form.validate("submit");
    return !stepHasErrors(target);
  };

  function goToStep(index: number) {
    setStepIndex(index);
    window.scrollTo({ top: 0 });
  }

  const advance = async () => {
    if (await validateStep(step)) goToStep(stepIndex + 1);
  };

  /** Only one step is mounted, so check them all and go to the first that fails. */
  const submitAll = async () => {
    await form.validate("submit");
    const failedStep = STRUCTURE_STEPS.findIndex(stepHasErrors);
    if (failedStep >= 0) {
      if (failedStep !== stepIndex) goToStep(failedStep);
      await validateStep(STRUCTURE_STEPS[failedStep]);
      return;
    }
    await form.handleSubmit();
  };

  const saveLabel = structure ? "Save changes" : "Create structure";

  return (
    <form.AppForm>
      <form
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void (atLastStep ? submitAll() : advance());
        }}
      >
        <StepProgress
          step={stepIndex + 1}
          total={STRUCTURE_STEPS.length}
          title={step.title}
          description={step.description}
          sticky={false}
        />

        {step.id === "rates" ? (
          <RatesStep
            form={form}
            carrierOptions={carrierOptions}
            leadSourceOptions={leadSourceOptions}
            leadSourceCarrierOptions={leadSourceCarrierOptions}
            leadSourcesUnavailable={leadSourcesUnavailable}
          />
        ) : step.id === "bonuses" ? (
          <BonusesStep form={form} />
        ) : (
          <PeopleStep form={form} options={peopleOptions} />
        )}

        {submitError ? (
          <FormError>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{submitError.message}</span>
              {submitError.stale ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-foreground"
                  onClick={onReload}
                >
                  <RefreshCw size={14} aria-hidden />
                  Reload
                </Button>
              ) : null}
            </div>
          </FormError>
        ) : null}

        <WizardFooter
          onBack={stepIndex > 0 ? () => goToStep(stepIndex - 1) : undefined}
          disabled={save.isPending}
          secondary={
            structure && !atLastStep ? (
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => void submitAll()}
              >
                Save changes
              </Button>
            ) : null
          }
        >
          <Button type="submit" disabled={save.isPending}>
            {atLastStep ? (save.isPending ? "Saving…" : saveLabel) : "Continue"}
          </Button>
        </WizardFooter>
      </form>
    </form.AppForm>
  );
}

/**
 * The carrier catalog by name, "Any other carrier" first, plus any carrier a
 * stored rule (carrier or lead-source) names that the catalog no longer
 * lists — so an old rule still renders as itself instead of an empty picker.
 */
function carrierOptionsFor(
  carriers: readonly CarrierOption[],
  values: StructureFormValues,
): ComboboxOption<string>[] {
  const names = new Set(carriers.map((carrier) => carrier.name));
  for (const rule of [...values.rules, ...values.leadSourceRules]) {
    if (rule.carrier && rule.carrier !== ANY_CARRIER) names.add(rule.carrier);
  }
  return [
    {
      value: ANY_CARRIER,
      label: rateRuleCarrierLabel(ANY_CARRIER),
      keywords: ["other", "default", "everything else"],
    },
    ...[...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name })),
  ];
}

/**
 * The agency's selectable lead sources in display order, plus any source a
 * stored rule names that the list no longer offers — an archived source,
 * which the API lets a structure keep but not add — so an old rule renders
 * as itself instead of an empty picker. Its name comes from the structure,
 * which the API resolved on read.
 */
function leadSourceOptionsFor(
  leadSources: readonly LeadSourceOption[],
  structure: PaymentStructureView | null,
): ComboboxOption<string>[] {
  const options: ComboboxOption<string>[] = leadSources.map((source) => ({
    value: source.id,
    label: source.name,
    keywords: [source.slug],
  }));
  const listed = new Set(options.map((option) => option.value));
  for (const rule of structure?.leadSourceRules ?? []) {
    if (listed.has(rule.leadSourceId)) continue;
    listed.add(rule.leadSourceId);
    options.push({
      value: rule.leadSourceId,
      label: rule.leadSourceName
        ? `${rule.leadSourceName} (archived)`
        : NOT_AVAILABLE,
    });
  }
  return options;
}

/**
 * Everyone who can be put on the structure. A member who has since left the
 * agency is listed too — still ticked, marked as removed — so saving does not
 * quietly drop them, and the owner can untick them on purpose.
 */
function peopleOptionsFor(
  people: readonly PayoutPersonView[],
  structure: PaymentStructureView | null,
): ChecklistOption[] {
  const options: ChecklistOption[] = people.map((person) => {
    const elsewhere =
      person.structure && person.structure.id !== structure?.id
        ? person.structure
        : null;
    return {
      value: person.id,
      label: person.name,
      detail: [
        person.roles.join(", "),
        person.branchName,
        person.status === "invited" ? "Invited" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      keywords: [person.email, ...person.roles],
      note: elsewhere ? `On ${elsewhere.name}` : undefined,
      noteWhenChosen: elsewhere ? `Moves from ${elsewhere.name}` : undefined,
    };
  });
  const listed = new Set(options.map((option) => option.value));
  for (const member of structure?.members ?? []) {
    if (listed.has(member.id)) continue;
    options.push({
      value: member.id,
      label: member.name,
      detail: "Removed from the agency",
      keywords: [member.email],
    });
  }
  return options;
}
