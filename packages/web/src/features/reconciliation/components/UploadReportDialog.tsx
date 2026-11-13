import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  MAX_RECONCILIATION_FILE_BYTES,
  RECONCILIATION_DUPLICATE_FILE,
  RECONCILIATION_FILE_EXTENSIONS,
} from "@sfa/shared";
import { FileDropzone } from "@/components/upload/FileDropzone";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import {
  reconciliationKey,
  uploadDashReport,
  type ReconciliationRunDetail,
} from "@/lib/carrier-reconciliation-api";
import { apiErrorCode, apiErrorMessage } from "../reconciliation-format";

/**
 * Browsers report an `.xlsx` as any of these, or as nothing at all; the
 * extension list is what actually decides.
 */
const ACCEPT = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/zip",
  "application/octet-stream",
] as const;

/**
 * Upload a Dash "New Business Details" export. The API reconciles it inside
 * the upload request, so the dialog stays open on a spinner until the run is
 * ready, then hands it to the page.
 */
export function UploadReportDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The finished run, or the existing one when this exact file was uploaded before. */
  onUploaded: (runId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: (selected: File) => uploadDashReport(selected),
    onSuccess: (run: ReconciliationRunDetail) => {
      void queryClient.invalidateQueries({ queryKey: reconciliationKey });
      toast.success("Report reconciled.");
      setFile(null);
      onUploaded(run.id);
    },
    onError: (error) => {
      if (apiErrorCode(error) === RECONCILIATION_DUPLICATE_FILE) {
        const runId = ((error as ApiError).body as { runId?: string })?.runId;
        toast.info("This report was already reconciled — showing that run.");
        setFile(null);
        if (runId) onUploaded(runId);
      }
    },
  });

  const refused =
    upload.isError && apiErrorCode(upload.error) !== RECONCILIATION_DUPLICATE_FILE;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (upload.isPending) return;
        if (!next) {
          setFile(null);
          upload.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a Dash report</DialogTitle>
          <DialogDescription>
            In Dash, open <span className="font-medium">Sold — New Business Details (All)</span>{" "}
            for the month and download it as Excel. Upload the file as it is;
            extra sheets you added are fine.
          </DialogDescription>
        </DialogHeader>

        <FileDropzone
          accept={ACCEPT}
          acceptExtensions={RECONCILIATION_FILE_EXTENSIONS}
          maxBytes={MAX_RECONCILIATION_FILE_BYTES}
          file={file}
          onSelect={(next) => {
            setFile(next);
            upload.reset();
          }}
          hint="One .xlsx file, up to 10MB"
          disabled={upload.isPending}
          aria-label="Upload the Dash report"
        />

        {refused && (
          <p role="alert" className="text-sm text-destructive">
            {apiErrorMessage(upload.error, "The report could not be reconciled. Try again.")}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={upload.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => file && upload.mutate(file)}
            disabled={!file || upload.isPending}
          >
            {upload.isPending && <Loader2 aria-hidden className="animate-spin" />}
            {upload.isPending ? "Reconciling…" : "Reconcile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
