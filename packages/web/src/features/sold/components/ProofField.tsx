import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { FormSubPanel } from "@/components/form";
import { FileDropzone } from "@/components/upload/FileDropzone";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ALLOWED_SOLD_UPLOAD_TYPES,
  MAX_SOLD_UPLOAD_BYTES,
  uploadSoldDocument,
} from "@/lib/sold-deals-api";
import type { SoldPolicyFormValues } from "./sold-deal-schema";

/** The three Card 5 discounts that carry a proof document. */
type ProofName =
  | "discounts.fireSubscription"
  | "discounts.roofReceipt"
  | "discounts.studentDiscount";

interface ProofFieldProps {
  leadId: string;
  name: ProofName;
  label: string;
  proofPrompt: string;
}

/**
 * A discount with the spec's yes/no → upload-or-audit fork.
 *
 * The fork is the point: answering **no** does not cancel the discount, it
 * hands the chase to the service team. Either way an audit item is generated —
 * with proof it arrives already resolved and carrying the document, without it
 * the item lands on the hand-off board. That is why "no proof" is presented as
 * a normal answer rather than a validation failure.
 */
export function ProofField({
  leadId,
  name,
  label,
  proofPrompt,
}: ProofFieldProps) {
  const form = useFormContext<SoldPolicyFormValues>();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const selected = useWatch({ control: form.control, name: `${name}.selected` });
  const hasProof = useWatch({ control: form.control, name: `${name}.hasProof` });
  const attachment = useWatch({
    control: form.control,
    name: `${name}.attachment`,
  });

  const onSelectFile = async (candidate: File | null) => {
    setFile(candidate);
    setUploadError(null);
    if (!candidate) {
      form.setValue(`${name}.attachment`, undefined);
      return;
    }

    setUploading(true);
    try {
      // Uploaded immediately rather than at submit: the wizard can span several
      // minutes, and deferring every file to the end would make a slow or
      // failed upload look like a failed sale.
      const meta = await uploadSoldDocument(leadId, candidate);
      form.setValue(`${name}.attachment`, meta, { shouldValidate: true });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
      setFile(null);
      form.setValue(`${name}.attachment`, undefined);
    } finally {
      setUploading(false);
    }
  };

  return (
    <FormItem className="space-y-2">
      <div className="flex flex-row items-center gap-2 space-y-0">
        <FormControl>
          <Checkbox
            checked={Boolean(selected)}
            onCheckedChange={(checked) => {
              const on = checked === true;
              form.setValue(`${name}.selected`, on);
              if (!on) {
                // Clear the branch entirely, so an un-ticked discount cannot
                // leave a stale document behind on submit.
                form.setValue(`${name}.hasProof`, false);
                form.setValue(`${name}.attachment`, undefined);
                setFile(null);
              }
            }}
          />
        </FormControl>
        <FormLabel className="font-normal">{label}</FormLabel>
      </div>

      {selected && (
        <FormSubPanel>
          <p className="text-sm text-foreground">{proofPrompt}</p>

          <RadioGroup
            value={hasProof ? "yes" : "no"}
            onValueChange={(value) => {
              const yes = value === "yes";
              form.setValue(`${name}.hasProof`, yes);
              if (!yes) {
                form.setValue(`${name}.attachment`, undefined);
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
            <FormDescription>
              The service team will chase this during onboarding.
            </FormDescription>
          )}
        </FormSubPanel>
      )}
    </FormItem>
  );
}
