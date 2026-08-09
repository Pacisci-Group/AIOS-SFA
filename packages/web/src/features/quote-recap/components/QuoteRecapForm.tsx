import type { QuoteRecapLeadContext } from "@sfa/shared";
import { Paperclip } from "lucide-react";
import { useState } from "react";
import { FormError, FormSection } from "@/components/form";
import { FieldShell, useFieldError } from "@/components/form/fields";
import { PolicyList } from "@/components/policies/PolicyList";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/upload/FileDropzone";
import { useAppForm } from "@/hooks/form";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/quote-recaps-api";
import { LeadContextHeader } from "./LeadContextHeader";
import { QuoteRecapPolicySheet } from "./QuoteRecapPolicySheet";
import {
  emptyQuotedPolicy,
  quoteRecapEditSchema,
  quoteRecapSchema,
  type QuoteRecapFormState,
  type QuotedPolicyFormValues,
} from "./quote-recap-schema";

/** Enough of an already-attached document to describe it in the form. */
export interface AttachedQuoteDocument {
  filename: string;
  contentType: string;
  size: number;
}

interface QuoteRecapFormProps {
  /**
   * `edit` relaxes the document requirement and swaps the copy; everything else
   * — the policy drawer, the per-policy addresses, the notes — is identical.
   * One component rather than a fork, so a change to the policy rules lands on
   * both paths (PAC-56 #11).
   */
  mode?: "create" | "edit";
  context: QuoteRecapLeadContext;
  /** Blank for create, the stored recap for edit. */
  initialValues: QuoteRecapFormState;
  /** The document already on the recap, if any. Edit mode only. */
  attachedDocument?: AttachedQuoteDocument | null;
  submitLabel?: string;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: QuoteRecapFormState) => void;
}

/**
 * Which policy the drawer is on. `index === null` means "adding"; the `key`
 * remounts the drawer's form so its `defaultValues` are re-read — without it,
 * opening policy 2 after policy 1 would show policy 1.
 */
interface PolicyEditorState {
  key: number;
  index: number | null;
  initial: QuotedPolicyFormValues;
}

/** Monotonic, so a re-open of the same row still remounts the drawer's form. */
let editorKey = 0;
const nextEditorKey = () => ++editorKey;

export function QuoteRecapForm({
  mode = "create",
  context,
  initialValues,
  attachedDocument = null,
  submitLabel,
  submitting,
  errorMessage,
  onSubmit,
}: QuoteRecapFormProps) {
  const isEdit = mode === "edit";
  const form = useAppForm({
    defaultValues: initialValues,
    validators: {
      /*
       * Both schemas validate the same `QuoteRecapFormState`; they differ only
       * in whether `quoteDocument` may be absent. The cast is on the *type* of
       * the branch, not its behaviour — TypeScript widens a ternary between two
       * zod schemas into a union that the validator slot won't accept, and
       * there is no way to express "either of these two" to it.
       */
      onBlur: (isEdit
        ? quoteRecapEditSchema
        : quoteRecapSchema) as typeof quoteRecapEditSchema,
    },
    // The schema above has already run; the page decides what to do with the
    // validated state (create narrows `quoteDocument` to present, edit leaves
    // it absent to mean "keep the attached document").
    onSubmit: ({ value }) => onSubmit(value),
  });
  const [editor, setEditor] = useState<PolicyEditorState | null>(null);

  // Default a new row's toggle on only when there is actually an address to
  // copy. Otherwise its fields would be blank *and* disabled, the conditional
  // required rule would fire, and the producer would be stuck.
  const canCopyHouseholdAddress = Boolean(context.householdAddress);
  const blocked = !context.householdId;

  return (
    <form.AppForm>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="space-y-6"
        noValidate
      >
        <LeadContextHeader context={context} />

        <FormSection
          title="Quoted policies"
          description="Add one for each policy quoted — the totals are calculated for you."
        >
          <form.Field name="policies" mode="array">
            {(field) => (
              <PolicyList
                policies={field.state.value}
                emptyMessage="No policies added yet — add the first one quoted."
                error={
                  field.state.meta.isTouched
                    ? field.state.meta.errors[0]?.message
                    : undefined
                }
                disabled={blocked}
                onAdd={() =>
                  setEditor({
                    key: nextEditorKey(),
                    index: null,
                    initial: emptyQuotedPolicy(canCopyHouseholdAddress),
                  })
                }
                onEdit={(index) =>
                  setEditor({
                    key: nextEditorKey(),
                    index,
                    initial: field.state.value[index]!,
                  })
                }
                onRemove={(index) => {
                  field.removeValue(index);
                  // The array's own `.min(1)` is an `onBlur` rule, and removing
                  // a row fires no blur — without this, emptying the list
                  // leaves it looking valid until submit.
                  field.handleBlur();
                }}
              />
            )}
          </form.Field>
        </FormSection>

        <FormSection
          title="Quote document"
          description={
            attachedDocument
              ? `Attached: ${attachedDocument.filename}. Upload a new file to replace it.`
              : "The carrier quote. Required."
          }
        >
          {/*
            ⚠ The `form.Field` is mounted unconditionally, and the "already
            attached" branch lives *inside* `FieldShell`'s children. Moving the
            branch outside would make the `useFieldError` call below conditional
            — a hook in a conditional render path.
          */}
          <form.Field name="quoteDocument">
            {(field) => (
              <FieldShell error={useFieldError(field.state.meta)}>
                {() => (
                  <div className="space-y-2">
                    {attachedDocument && !field.state.value && (
                      <p className="flex items-center gap-2 rounded-lg border border-border bg-sunken px-3 py-2 text-sm text-muted-foreground">
                        <Paperclip className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-card-foreground">
                          {attachedDocument.filename}
                        </span>
                        <span className="shrink-0">
                          {Math.max(1, Math.round(attachedDocument.size / 1024))} KB
                        </span>
                      </p>
                    )}
                    <FileDropzone
                      accept={ALLOWED_UPLOAD_TYPES}
                      maxBytes={MAX_UPLOAD_BYTES}
                      file={field.state.value ?? null}
                      onSelect={(file) => {
                        field.handleChange(file ?? undefined);
                        field.handleBlur();
                      }}
                      hint="PDF up to 10MB"
                      disabled={submitting}
                      aria-label={
                        attachedDocument
                          ? "Replace the quote document"
                          : "Upload the quote document"
                      }
                    />
                  </div>
                )}
              </FieldShell>
            )}
          </form.Field>
        </FormSection>

        <FormSection title="Notes">
          <form.AppField name="notes">
            {(f) => (
              <f.TextareaField
                label="Notes"
                srOnlyLabel
                rows={4}
                placeholder="Anything the next person needs to know about this proposal."
                textareaClassName="bg-card border-border"
              />
            )}
          </form.AppField>
        </FormSection>

        <FormError>{errorMessage}</FormError>

        <Button
          type="submit"
          variant="brand"
          disabled={submitting || blocked}
          className="w-full sm:w-auto active:scale-95"
        >
          {submitting ? "Saving…" : (submitLabel ?? "Record quote recap")}
        </Button>
      </form>

      {/*
        Outside the `<form>` element: the drawer is a separate form of its own,
        and nesting one inside another is invalid HTML even though Radix portals
        the content to the body anyway. Mounted only while open and keyed, so
        `useAppForm` re-reads its `defaultValues` on every open.
      */}
      {editor && (
        <QuoteRecapPolicySheet
          key={editor.key}
          open
          onOpenChange={(next) => !next && setEditor(null)}
          initial={editor.initial}
          isEdit={editor.index !== null}
          householdAddress={context.householdAddress}
          onSave={(policy) => {
            if (editor.index === null) {
              form.pushFieldValue("policies", policy);
            } else {
              void form.replaceFieldValue("policies", editor.index, policy);
            }
          }}
        />
      )}
    </form.AppForm>
  );
}
