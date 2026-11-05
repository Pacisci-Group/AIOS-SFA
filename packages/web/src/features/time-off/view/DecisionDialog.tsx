import { z } from "zod";
import { TIME_OFF_NOTE_MAX_LENGTH } from "@sfa/shared";
import { FormError } from "@/components/form";
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

export interface DecisionCopy {
  title: string;
  description: string;
  noteLabel: string;
  /** Request changes, decline and a reviewer's cancellation need the note. */
  noteRequired: boolean;
  /** A plain confirmation: discarding a draft takes no note. */
  noteHidden?: boolean;
  confirmLabel: string;
}

/**
 * The note that goes with a decision (PAC-165). A note is written only with
 * an action, so each action that takes one asks here — required where the
 * employee needs the reason (request changes, decline, cancelling their
 * approved leave), optional on an approval.
 */
export function DecisionDialog({
  copy,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  copy: DecisionCopy;
  pending: boolean;
  error: string | null;
  onConfirm: (note: string) => void;
  onClose: () => void;
}) {
  const form = useAppForm({
    defaultValues: { note: "" },
    validators: {
      onBlur: z.object({
        note: copy.noteRequired
          ? z
              .string()
              .trim()
              .min(1, "Write a note for the employee.")
              .max(TIME_OFF_NOTE_MAX_LENGTH)
          : z.string().max(TIME_OFF_NOTE_MAX_LENGTH),
      }),
    },
    onSubmit: ({ value }) => onConfirm(value.note.trim()),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form.AppForm>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            {!copy.noteHidden && (
              <form.AppField name="note">
                {(f) => (
                  <f.TextareaField
                    label={copy.noteLabel}
                    description={copy.noteRequired ? undefined : "Optional."}
                    rows={3}
                  />
                )}
              </form.AppField>
            )}
            <FormError>{error}</FormError>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                Back
              </Button>
              <Button type="submit" variant="brand" disabled={pending}>
                {pending ? "Saving…" : copy.confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
