import type { QuoteRecapLeadContext } from "@sfa/shared";
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
  emptyQuoteRecap,
  emptyQuotedPolicy,
  parseQuoteRecap,
  quoteRecapSchema,
  type QuoteRecapFormValues,
  type QuotedPolicyFormValues,
} from "./quote-recap-schema";

interface QuoteRecapFormProps {
  context: QuoteRecapLeadContext;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: QuoteRecapFormValues) => void;
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
  context,
  submitting,
  errorMessage,
  onSubmit,
}: QuoteRecapFormProps) {
  const form = useAppForm({
    defaultValues: emptyQuoteRecap(),
    validators: { onBlur: quoteRecapSchema },
    // Validation has already passed here; the parse narrows the optional
    // `quoteDocument` of form state to the required one of the wire shape.
    onSubmit: ({ value }) => onSubmit(parseQuoteRecap(value)),
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

        <FormSection title="Quote document" description="The carrier quote. Required.">
          <form.Field name="quoteDocument">
            {(field) => (
              <FieldShell error={useFieldError(field.state.meta)}>
                {() => (
                  <FileDropzone
                    accept={ALLOWED_UPLOAD_TYPES}
                    maxBytes={MAX_UPLOAD_BYTES}
                    file={field.state.value ?? null}
                    onSelect={(file) => {
                      field.handleChange(file ?? undefined);
                      field.handleBlur();
                    }}
                    hint="PDF, JPG, PNG up to 10MB"
                    disabled={submitting}
                    aria-label="Upload the quote document"
                  />
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
          {submitting ? "Saving…" : "Record quote recap"}
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
