import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  MAX_PAYOUT_IMPORT_FILE_BYTES,
  PAYOUT_IMPORT_DUPLICATE_FILE,
  PAYOUT_IMPORT_FILE_EXTENSIONS,
  type ChargebackImportView,
} from "@sfa/shared";
import type { ComboboxOption } from "@/components/form/fields";
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
import { useAppForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import { carriersKey, getCarriers } from "@/lib/carriers-api";
import { formatMonth, recentMonths } from "@/lib/months";
import { payoutImportsKey, uploadChargebackReport } from "@/lib/payouts-api";
import { payoutErrorCode, payoutErrorMessage } from "../payout-errors";

/**
 * Browsers report an `.xlsx` or a `.csv` as any of these, or as nothing at
 * all; the extension list is what actually decides.
 */
const ACCEPT = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/zip",
  "application/octet-stream",
  "text/csv",
  "text/plain",
] as const;

const DEFAULT_CARRIER = "Allstate";

const uploadFormSchema = z.object({
  carrier: z.string().trim().min(1, "Choose a carrier."),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Choose a month."),
});

/**
 * Upload the month's chargeback report (PAC-180). The API reads and matches
 * it inside the request and answers with a preview — nothing is charged until
 * the owner commits it there.
 */
export function ImportChargebacksDialog({
  open,
  onOpenChange,
  month,
  currentMonth,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page's month — the default pay month. */
  month: string;
  currentMonth: string;
  /** The new preview, or the import that already holds this exact file. */
  onImported: (importId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fileMissing, setFileMissing] = useState(false);

  const carriers = useQuery({
    queryKey: carriersKey,
    queryFn: getCarriers,
    staleTime: 10 * 60_000,
    enabled: open,
  });
  const carrierOptions = useMemo<ComboboxOption<string>[]>(() => {
    const names = new Set((carriers.data ?? []).map((carrier) => carrier.name));
    names.add(DEFAULT_CARRIER);
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name }));
  }, [carriers.data]);
  // The last twelve months, plus the page's month when it is older, so the
  // default the form starts on is always one the picker shows.
  const monthOptions = useMemo(() => {
    const months = recentMonths(currentMonth, 12);
    if (!months.includes(month)) months.push(month);
    return months.map((value) => ({ value, label: formatMonth(value) }));
  }, [currentMonth, month]);

  const upload = useMutation({
    mutationFn: (input: { file: File; carrier: string; month: string }) =>
      uploadChargebackReport(input.file, {
        carrier: input.carrier,
        month: input.month,
      }),
    onSuccess: (created: ChargebackImportView) => {
      void queryClient.invalidateQueries({ queryKey: payoutImportsKey });
      toast.success("Report read. Check the lines, then commit them.");
      close();
      onImported(created.id);
    },
    onError: (error) => {
      if (payoutErrorCode(error) === PAYOUT_IMPORT_DUPLICATE_FILE) {
        const importId = ((error as ApiError).body as { importId?: string })
          ?.importId;
        toast.info("This report was already imported — showing that import.");
        close();
        if (importId) onImported(importId);
      }
    },
  });

  const form = useAppForm({
    defaultValues: { carrier: DEFAULT_CARRIER, month },
    validators: { onBlur: uploadFormSchema },
    onSubmit: ({ value }) => {
      if (!file) {
        setFileMissing(true);
        return;
      }
      upload.mutate({ file, carrier: value.carrier, month: value.month });
    },
  });

  function close() {
    setFile(null);
    setFileMissing(false);
    upload.reset();
    form.reset();
    onOpenChange(false);
  }

  const refused =
    upload.isError &&
    payoutErrorCode(upload.error) !== PAYOUT_IMPORT_DUPLICATE_FILE;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (upload.isPending) return;
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload chargebacks</DialogTitle>
          <DialogDescription>
            The month's approved chargebacks, as a spreadsheet or a CSV. Each
            line needs a policy number and an amount (Prorated Amount); the
            Producer or SOK column says who to charge.
          </DialogDescription>
        </DialogHeader>

        <form.AppForm>
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="month">
                {(field) => (
                  <field.SelectField
                    label="Pay month"
                    description="The statements they come off."
                    options={monthOptions}
                    disabled={upload.isPending}
                  />
                )}
              </form.AppField>
              <form.AppField name="carrier">
                {(field) => (
                  <field.ComboboxField
                    label="Carrier"
                    description="For lines that don't name one."
                    options={carrierOptions}
                    placeholder="Choose a carrier"
                    searchPlaceholder="Search carriers"
                    disabled={upload.isPending}
                  />
                )}
              </form.AppField>
            </div>

            <div className="space-y-1.5">
              <FileDropzone
                accept={ACCEPT}
                acceptExtensions={PAYOUT_IMPORT_FILE_EXTENSIONS}
                maxBytes={MAX_PAYOUT_IMPORT_FILE_BYTES}
                file={file}
                onSelect={(next) => {
                  setFile(next);
                  setFileMissing(false);
                  upload.reset();
                }}
                hint="One .xlsx or .csv file, up to 10MB"
                disabled={upload.isPending}
                aria-label="Upload the chargeback report"
              />
              {fileMissing && (
                <p role="alert" className="text-sm text-destructive">
                  Choose the report file.
                </p>
              )}
            </div>

            {refused && (
              <p role="alert" className="text-sm text-destructive">
                {payoutErrorMessage(upload.error)}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={close}
                disabled={upload.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={upload.isPending}>
                {upload.isPending && (
                  <Loader2 aria-hidden className="animate-spin" />
                )}
                {upload.isPending ? "Reading…" : "Read the report"}
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
