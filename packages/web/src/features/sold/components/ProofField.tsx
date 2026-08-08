import { useStore } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { FormSubPanel } from "@/components/form";
import { FileDropzone } from "@/components/upload/FileDropzone";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { withFieldGroup } from "@/hooks/form";
import {
  ALLOWED_SOLD_UPLOAD_TYPES,
  MAX_SOLD_UPLOAD_BYTES,
  uploadSoldDocument,
} from "@/lib/sold-deals-api";
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

const proofDefaults: ProofValues = { selected: false, hasProof: false };

/**
 * A discount with the spec's yes/no → upload-or-audit fork.
 *
 * The fork is the point: answering **no** does not cancel the discount, it
 * hands the chase to the service team. Either way an audit item is generated —
 * with proof it arrives already resolved and carrying the document, without it
 * the item lands on the hand-off board. That is why "no proof" is presented as
 * a normal answer rather than a validation failure.
 *
 * Which discount this is comes from `fields` at the call site. The previous
 * version took a `name` prop typed as a hand-written union of the three literal
 * paths, which is the same nominal typing this refactor exists to remove — the
 * union was correct only for as long as someone kept it in step with the schema.
 */
export const ProofField = withFieldGroup({
  defaultValues: proofDefaults,
  props: { leadId: "", label: "", proofPrompt: "" },
  render: function Render({ group, leadId, label, proofPrompt }) {
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [file, setFile] = useState<File | null>(null);

    const selected = useStore(group.store, (s) => s.values.selected);
    const hasProof = useStore(group.store, (s) => s.values.hasProof);
    const attachment = useStore(group.store, (s) => s.values.attachment);

    const onSelectFile = async (candidate: File | null) => {
      setFile(candidate);
      setUploadError(null);
      if (!candidate) {
        group.setFieldValue("attachment", undefined);
        return;
      }

      setUploading(true);
      try {
        // Uploaded immediately rather than at submit: the wizard can span several
        // minutes, and deferring every file to the end would make a slow or
        // failed upload look like a failed sale.
        const meta = await uploadSoldDocument(leadId, candidate);
        group.setFieldValue("attachment", meta);
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "Upload failed");
        setFile(null);
        group.setFieldValue("attachment", undefined);
      } finally {
        setUploading(false);
      }
    };

    // `content-start`: the anti-stretch fix `FieldShell` documents.
    return (
      <div data-slot="form-item" className="grid content-start gap-2 space-y-2">
        <group.AppField name="selected">
          {(f) => (
            <f.CheckboxField
              label={label}
              onChanged={(on) => {
                if (on) return;
                // Clear the branch entirely, so an un-ticked discount cannot
                // leave a stale document behind on submit.
                group.setFieldValue("hasProof", false);
                group.setFieldValue("attachment", undefined);
                setFile(null);
              }}
            />
          )}
        </group.AppField>

        {selected && (
          <FormSubPanel>
            <p className="text-sm text-foreground">{proofPrompt}</p>

            <RadioGroup
              value={hasProof ? "yes" : "no"}
              onValueChange={(value) => {
                const yes = value === "yes";
                group.setFieldValue("hasProof", yes);
                if (!yes) {
                  group.setFieldValue("attachment", undefined);
                  setFile(null);
                }
              }}
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="yes" />
                Yes, attach it
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="no" />
                No — send to audit
              </label>
            </RadioGroup>

            {hasProof ? (
              <div className="space-y-2">
                <FileDropzone
                  accept={ALLOWED_SOLD_UPLOAD_TYPES}
                  maxBytes={MAX_SOLD_UPLOAD_BYTES}
                  file={file}
                  onSelect={(candidate) => void onSelectFile(candidate)}
                  disabled={uploading}
                  aria-label={`Upload proof for ${label}`}
                  hint="PDF, JPEG or PNG, up to 10MB"
                />
                {uploading && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 size={13} className="animate-spin" />
                    Uploading…
                  </p>
                )}
                {uploadError && (
                  <p className="text-sm text-destructive">{uploadError}</p>
                )}
                {attachment && !uploading && (
                  <p className="text-xs text-emerald-500">
                    Attached — {attachment.filename}
                  </p>
                )}
              </div>
            ) : (
              <p
                data-slot="form-description"
                className="text-sm text-muted-foreground"
              >
                The service team will chase this during onboarding.
              </p>
            )}
          </FormSubPanel>
        )}
      </div>
    );
  },
});
