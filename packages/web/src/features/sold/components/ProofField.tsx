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
 * A discount that can carry its proof — but does not have to (PAC-65).
 *
 * ## What changed
 *
 * PAC-56 #21 made the document mandatory whenever the box was ticked. PAC-65
 * reverses that: **ticking the box always generates the audit item, uploaded
 * document or not.** David, asked whether the audit fires only when details are
 * missing: *"No, even if the details are provided, you're still gonna audit it
 * because we have to make sure — they have to check it for accuracy."*
 *
 * So the upload is never the gate; it only decides how much work the audit is.
 * `auditAttachmentsByItem` maps an attached file onto the audit item it
 * evidences, so the service team opens the hand-off board and verifies it in
 * place. With nothing attached, the same item tells them to call the client and
 * obtain it. Either way the item opens as **outstanding** — a document is
 * evidence for the auditor, not a resolution.
 *
 * `proofPrompt` therefore names the document as a request, not a requirement:
 * it is the only place that copy lives now that the schema has no per-document
 * message to carry.
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
            <p className="text-sm text-foreground">
              {proofPrompt}{" "}
              <span className="text-muted-foreground">
                Optional — without it the audit team will call the client for it.
              </span>
            </p>
            {/*
              * Bound through the field rather than `group.setFieldValue` so an
              * upload error is readable here, and `handleBlur` runs the moment
              * the upload lands rather than at the next Continue.
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
