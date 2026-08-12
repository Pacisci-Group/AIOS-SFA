import type { UploadScope } from "@/lib/sold-deals-api";
import { useStore } from "@tanstack/react-form";
import { FormSubPanel } from "@/components/form";
import { useFieldError } from "@/components/form/fields";
import { withFieldGroup } from "@/hooks/form";
import { SoldDocumentUpload } from "./SoldDocumentUpload";
import type { SoldPolicyFormValues } from "./sold-deal-schema";

/**
 * The slice of form state one proof-carrying discount owns.
 *
 * Derived from the schema rather than written out, which keeps `attachment` an
 * **optional key** — declaring it as a required key holding `undefined` is a
 * different type, and a field group requires every key it declares to line up
 * with the parent's.
 */
type ProofValues = SoldPolicyFormValues["discounts"]["fireSubscription"];

const proofDefaults: ProofValues = { selected: false };

/**
 * A discount whose proof is **required** to claim it (PAC-56 #21).
 *
 * ## What changed
 *
 * This used to offer a yes/no fork: "no, I don't have it" was a valid answer
 * that handed the chase to the service team. David asked for the document up
 * front, so selecting a discount now requires attaching its proof — there is no
 * "no" branch, and `hasProof` is gone from form state entirely.
 *
 * The proof does not merely sit in storage: `auditAttachmentsByItem` maps it
 * onto the audit item it evidences, so the service team opens the hand-off
 * board and finds the file already there. The item still opens as **outstanding**
 * — a document is evidence for the auditor, not a resolution.
 *
 * Which discount this is comes from `fields` at the call site, so a schema
 * rename is a compile error rather than a runtime miss.
 */
export const ProofField = withFieldGroup({
  defaultValues: proofDefaults,
  props: {
    uploadScope: { kind: "lead", leadId: "" } as UploadScope,
    label: "",
    proofPrompt: "",
  },
  render: function Render({ group, uploadScope, label, proofPrompt }) {
    const selected = useStore(group.store, (s) => s.values.selected);

    // `content-start`: the anti-stretch fix `FieldShell` documents.
    return (
      <div data-slot="form-item" className="grid content-start gap-2 space-y-2">
        <group.AppField name="selected">
          {(f) => (
            <f.CheckboxField
              label={label}
              onChanged={(on) => {
                // Clear the branch entirely when un-ticked, so a discount the
                // producer changed their mind about cannot leave a stale
                // document behind on submit.
                if (!on) group.setFieldValue("attachment", undefined);
              }}
            />
          )}
        </group.AppField>

        {selected && (
          <FormSubPanel>
            <p className="text-sm text-foreground">{proofPrompt}</p>
            {/*
              * Bound through the field rather than `group.setFieldValue`, so the
              * schema's "attach the document" error — which zod reports against
              * `attachment` — is readable here, and `handleBlur` clears it the
              * moment an upload satisfies it rather than at the next Continue.
              */}
            <group.Field name="attachment">
              {(field) => (
                <SoldDocumentUpload
                  uploadScope={uploadScope}
                  value={field.state.value}
                  onChange={(meta) => {
                    field.handleChange(meta);
                    field.handleBlur();
                  }}
                  ariaLabel={`Upload proof for ${label}`}
                  error={useFieldError(field.state.meta)}
                />
              )}
            </group.Field>
          </FormSubPanel>
        )}
      </div>
    );
  },
});
