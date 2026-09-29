import { useState } from "react";
import { Download, FilePlus2, FileSpreadsheet, Loader2, X } from "lucide-react";
import type { MailerCampaign } from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileDropzone } from "@/components/upload/FileDropzone";
import { openDocumentInNewTab } from "@/lib/open-document";
import {
  ALLOWED_CAMPAIGN_FILE_EXTENSIONS,
  ALLOWED_CAMPAIGN_FILE_TYPES,
  MAX_CAMPAIGN_FILE_BYTES,
  canAddFiles,
  canRemoveFiles,
  getCampaignFileUrl,
  importsAsIs,
} from "@/lib/platform-campaigns-api";
import { formatBytes } from "../campaign-format";

/**
 * The campaign's vendor files, and the way more get onto it (PAC-142).
 *
 * Shown on the preview and the outcome steps of the wizard. Before a commit it
 * is "I forgot the second file": add or remove, and the campaign reads them all
 * again. After a commit it is **Add records**: the campaign re-opens, is
 * previewed again over every file, and committed again — rows already imported
 * are updated in place and only the new ones go in the print file. Removing is
 * refused from the first commit on, because the list is then the record of
 * what was imported.
 *
 * Adding is a two-step affordance — pick, then confirm — so an operator
 * dropping three files does not trigger three re-reads of a 23 MB campaign.
 */
export function CampaignFilesCard({
  campaign,
  adding,
  removing,
  onAdd,
  onRemove,
  title = "Files",
}: {
  campaign: MailerCampaign;
  adding: boolean;
  removing: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (fileId: string) => void;
  title?: string;
}) {
  const [pending, setPending] = useState<File[]>([]);
  const busy = adding || removing;
  const removable = canRemoveFiles(campaign);
  const addable = canAddFiles(campaign);
  const reopens = campaign.status === "imported";
  const asIs = importsAsIs(campaign);
  // A migrated campaign: its mailers came from ApexReports' BigQuery tables,
  // and nothing recorded what floor or discount table that run used.
  const migrated = campaign.source === "migration" || campaign.source === "demo";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-card-foreground">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {campaign.files.length === 0
              ? "No files yet — this week was migrated"
              : campaign.files.length === 1
                ? "1 file, read together as one week"
                : `${campaign.files.length} files, read together as one week`}
          </p>
        </div>

        <ul className="flex flex-col gap-2">
          {campaign.files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-background/40 px-4 py-3"
            >
              <FileSpreadsheet className="size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Download ${file.name}`}
                onClick={() =>
                  void openDocumentInNewTab(() =>
                    getCampaignFileUrl(campaign.id, file.id).then((r) => r.url),
                  )
                }
              >
                <Download className="size-4" />
              </Button>
              {removable && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${file.name}`}
                  disabled={busy}
                  onClick={() => onRemove(file.id)}
                >
                  <X className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>

        {addable && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              {migrated
                ? "This campaign was migrated and recorded no pricing settings, so files added here are imported as they stand — upload a processed file, not the raw vendor file. Rows already here are updated, and only the new ones go in the print file."
                : reopens && asIs
                  ? "Add the processed records the file missed. Files are imported as they stand; rows already here are updated, and only the new ones go in the print file."
                  : reopens
                    ? "Add the records the vendor file missed. The campaign is read again over every file; rows already here are updated, and only the new ones go in the print file."
                    : "Forgot a file? Add it here and the campaign is read again over all of them."}
            </p>
            <FileDropzone
              multiple
              accept={ALLOWED_CAMPAIGN_FILE_TYPES}
              acceptExtensions={ALLOWED_CAMPAIGN_FILE_EXTENSIONS}
              maxBytes={MAX_CAMPAIGN_FILE_BYTES}
              files={pending}
              onSelectFiles={setPending}
              hint={
                campaign.files.length === 0
                  ? "Processed XLSX or CSV, up to 100MB each"
                  : "Same columns as the files above · XLSX or CSV up to 100MB"
              }
              disabled={busy}
              aria-label="Add files to the campaign"
            />
            {pending.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    onAdd(pending);
                    setPending([]);
                  }}
                >
                  {adding ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FilePlus2 className="size-4" />
                  )}
                  {adding
                    ? "Uploading…"
                    : reopens
                      ? `Add ${pending.length === 1 ? "this file" : `these ${pending.length} files`} and read again`
                      : `Add ${pending.length === 1 ? "this file" : `these ${pending.length} files`}`}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setPending([])}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
