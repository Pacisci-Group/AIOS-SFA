import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import type { ChargebackImportRowView, ImportPersonOption } from "@sfa/shared";
import type { ComboboxOption } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppForm } from "@/hooks/form";
import { formatMoney } from "@/lib/money";
import { listImportPeople, payoutImportPeopleKey } from "@/lib/payouts-api";
import { SIGNAL_LABELS } from "./import-format";

const assignFormSchema = z.object({
  // Starts undefined, so the picker shows its placeholder rather than a blank.
  userId: z
    .string()
    .optional()
    .refine((value) => Boolean(value), "Choose who to charge."),
});
type AssignFormValues = z.input<typeof assignFormSchema>;

/**
 * Choose who a report line is charged to (PAC-180). The people its signals
 * pointed at — the SOK number, the name in the file, the app's seller — come
 * first; anyone in the agency can be chosen, people who have left included.
 */
export function AssignRowDialog({
  row,
  pending,
  onCancel,
  onAssign,
}: {
  /** The line being assigned; `null` closes the dialog. */
  row: ChargebackImportRowView | null;
  pending: boolean;
  onCancel: () => void;
  onAssign: (userId: string) => void;
}) {
  const people = useQuery({
    queryKey: payoutImportPeopleKey,
    queryFn: listImportPeople,
    staleTime: 60_000,
    enabled: row !== null,
  });

  const options = useMemo<ComboboxOption<string>[]>(() => {
    if (!row) return [];
    const suggested = new Set(row.candidates.map((c) => c.userId));
    const everyone = people.data?.people ?? [];
    const byId = new Map(everyone.map((person) => [person.id, person]));
    return [
      ...row.candidates.map((candidate) => ({
        value: candidate.userId,
        label: personLabel(byId.get(candidate.userId), candidate.name),
        keywords: [SIGNAL_LABELS[candidate.via]],
        group: "Suggested",
      })),
      ...everyone
        .filter((person) => !suggested.has(person.id))
        .map((person) => ({
          value: person.id,
          label: personLabel(person, person.name),
          keywords: [person.allstateBindId ?? "", person.branchName ?? ""],
          group: "Everyone",
        })),
    ];
  }, [row, people.data]);

  return (
    <Dialog open={row !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Who is charged for row {row?.rowNumber}?</DialogTitle>
          <DialogDescription>
            {row
              ? `${row.customerName ?? "Policy"} ${row.policyNumber ?? ""} · ${formatMoney(row.amount)}`
              : null}
          </DialogDescription>
        </DialogHeader>
        {row && (
          <AssignForm
            key={row.rowNumber}
            options={options}
            defaultUserId={row.chargedTo?.userId ?? ""}
            loading={people.isPending}
            pending={pending}
            onCancel={onCancel}
            onAssign={onAssign}
            suggestions={row.candidates.map(
              (candidate) =>
                `${candidate.name}: ${SIGNAL_LABELS[candidate.via].toLowerCase()}`,
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssignForm({
  options,
  defaultUserId,
  loading,
  pending,
  onCancel,
  onAssign,
  suggestions,
}: {
  options: ComboboxOption<string>[];
  defaultUserId: string;
  loading: boolean;
  pending: boolean;
  onCancel: () => void;
  onAssign: (userId: string) => void;
  suggestions: string[];
}) {
  const defaultValues: AssignFormValues = {
    userId: defaultUserId || undefined,
  };
  const form = useAppForm({
    defaultValues,
    validators: { onBlur: assignFormSchema },
    onSubmit: ({ value }) => {
      if (value.userId) onAssign(value.userId);
    },
  });

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
        {suggestions.length > 0 && (
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {suggestions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <form.AppField name="userId">
          {(field) => (
            <field.ComboboxField
              label="Charge to"
              options={options}
              placeholder={loading ? "Loading people…" : "Choose a person"}
              searchPlaceholder="Search by name or SOK number"
              emptyText="Nobody by that name."
              disabled={pending}
            />
          )}
        </form.AppField>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            Charge them
          </Button>
        </DialogFooter>
      </form>
    </form.AppForm>
  );
}

/** "Jessica Yates · SOK35W0D (left)". */
function personLabel(
  person: ImportPersonOption | undefined,
  fallback: string,
): string {
  if (!person) return fallback;
  const parts = [person.name];
  if (person.allstateBindId) parts.push(person.allstateBindId);
  const label = parts.join(" · ");
  if (person.status === "deactivated") return `${label} (left)`;
  if (person.status === "invited") return `${label} (invited)`;
  return label;
}
