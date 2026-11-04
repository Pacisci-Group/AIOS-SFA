import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import type { HrPolicyView, UpdateHrPolicyInput } from "@sfa/shared";
import { FormError } from "@/components/form";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAppForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import { archiveHrPolicy, hrKeys, updateHrPolicy } from "@/lib/hr-api";
import { PolicyWizardShell } from "../PolicyWizardShell";
import { AccrualStep } from "./steps/AccrualStep";
import { BasicSetupStep } from "./steps/BasicSetupStep";
import { EnrollmentStep } from "./steps/EnrollmentStep";
import { AutoApproveFields, ReviewSections } from "./steps/ReviewStep";
import { SettingsStep } from "./steps/SettingsStep";
import { summarizeTimeOff, timeOffKindLabel } from "./time-off-display";
import {
  fromPolicy,
  timeOffFormSchema,
  toSectionPatch,
  type TimeOffFormValues,
  type TimeOffSection,
} from "./time-off-form";

type TimeOffPolicyView = Extract<HrPolicyView, { type: "time_off" }>;

const SECTION_TITLES: Record<TimeOffSection, string> = {
  basics: "Basic setup",
  settings: "Settings",
  accrual: "Accrual",
  enrollment: "Enrollment",
  autoApprove: "Auto-approve requests",
};

/**
 * An activated time off policy (PAC-174): the Review layout, read-only,
 * with Edit on each section opening a drawer that holds that section's
 * step on its own form and saves only its fields. Paid/unpaid and
 * Unlimited are shown disabled with the reason. Archive keeps the ledger
 * and history and is refused while a request is waiting for a decision.
 */
export function TimeOffPolicyPage({ policy }: { policy: TimeOffPolicyView }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<TimeOffSection | null>(null);
  const [archiving, setArchiving] = useState(false);

  const archive = useMutation({
    mutationFn: () => archiveHrPolicy(policy.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: hrKeys.all });
      toast.success(`Archived ${policy.name}.`);
      navigate("/settings/hr-policies?type=time_off");
    },
    onError: (error) => {
      setArchiving(false);
      toast.error(error instanceof ApiError ? error.message : "Could not archive the policy.");
    },
  });

  return (
    <PolicyWizardShell
      type="time_off"
      title={policy.name}
      caption={`${timeOffKindLabel(policy.timeOff)} · ${summarizeTimeOff(policy.timeOff)}`}
      action={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Policy actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setArchiving(true)}
            >
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Active</Badge>
        <span className="text-sm text-muted-foreground">
          {policy.memberCount} {policy.memberCount === 1 ? "person" : "people"}
        </span>
      </div>

      <div className="space-y-4">
        <ReviewSections
          name={policy.name}
          rules={policy.timeOff}
          memberIds={policy.members.map((m) => m.id)}
          members={policy.members}
          onEdit={setEditing}
        />
      </div>

      {editing && (
        <SectionDrawer
          key={editing}
          policy={policy}
          section={editing}
          onClose={() => setEditing(null)}
        />
      )}

      <AlertDialog open={archiving} onOpenChange={(open) => !open && setArchiving(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {policy.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {policy.memberCount
                ? `The ${policy.memberCount} ${policy.memberCount === 1 ? "person" : "people"} in it can no longer request this kind of time off until they are added to another policy. `
                : "Nobody is in this policy. "}
              Balances and history are kept. A policy with a request still waiting for a decision
              cannot be archived.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending}
              onClick={(event) => {
                event.preventDefault();
                archive.mutate();
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PolicyWizardShell>
  );
}

/**
 * One section's edit drawer: the same step component the wizard renders,
 * on a form seeded from the policy, saving only that section's fields.
 * Remounted by `key` per section so a fresh form opens each time.
 */
function SectionDrawer({
  policy,
  section,
  onClose,
}: {
  policy: TimeOffPolicyView;
  section: TimeOffSection;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: UpdateHrPolicyInput) => updateHrPolicy(policy.id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: hrKeys.all });
      toast.success(`Saved ${SECTION_TITLES[section].toLowerCase()}.`);
      onClose();
    },
    onError: (failure) => {
      setError(failure instanceof ApiError ? failure.message : "Could not save. Try again.");
    },
  });

  const form = useAppForm({
    defaultValues: fromPolicy(policy),
    validators: { onBlur: timeOffFormSchema },
    onSubmit: ({ value }: { value: TimeOffFormValues }) => {
      setError(null);
      save.mutate(toSectionPatch(section, value));
    },
  });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="gap-1 border-b border-border px-6 py-5">
          <SheetDescription className="text-xs uppercase tracking-widest text-muted-foreground">
            {policy.name}
          </SheetDescription>
          <SheetTitle className="font-semibold text-foreground">
            Edit {SECTION_TITLES[section].toLowerCase()}
          </SheetTitle>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col gap-4 px-6 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          {section === "basics" && <BasicSetupStep form={form} locked />}
          {section === "settings" && <SettingsStep form={form} />}
          {section === "accrual" && <AccrualStep form={form} />}
          {section === "enrollment" && (
            <EnrollmentStep
              form={form}
              policyId={policy.id}
              existingMemberIds={policy.members.map((m) => m.id)}
            />
          )}
          {section === "autoApprove" && <AutoApproveFields form={form} />}

          <FormError>{error}</FormError>

          <div className="mt-auto flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
