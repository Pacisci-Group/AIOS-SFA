import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Trash2,
} from "lucide-react";
import type { MailerCampaign, MailerCommitRequest } from "@sfa/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCampaignNumber,
  formatCount,
  formatMoney,
  formatRate,
} from "../campaign-format";
import { CampaignStatusBadge } from "../CampaignStatusBadge";
import { RejectionsTable } from "./RejectionsTable";
import { StatTile } from "./StatTile";
import { UnmatchedZipsResolver } from "./UnmatchedZipsResolver";

/**
 * What the file contains, before anything is written (PAC-71).
 *
 * Everything on this screen is a projection: no mailer exists yet, and
 * cancelling writes nothing. The one control that changes that is Commit, and
 * every gate the server enforces is stated here first — an unmatched carrier
 * code as a blocking alert, an overwrite's delete count as an exact number in a
 * confirmation dialog — so a 409 is never the first the operator hears of it.
 */
export function CampaignPreviewReport({
  campaign,
  savingZips,
  committing,
  onResolveZips,
  onCommit,
}: {
  campaign: MailerCampaign;
  savingZips: boolean;
  committing: boolean;
  onResolveZips: (resolutions: Record<string, string>) => void;
  onCommit: (request: MailerCommitRequest) => void;
}) {
  const preview = campaign.preview;
  const [mode, setMode] = useState<"append" | "overwrite">("append");
  const [replaceIds, setReplaceIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!preview) return null;

  const stats = preview.stats;
  const unmatchedCodes = preview.assignment.unmatched;
  const existing = preview.existingCampaigns;
  const overlap = preview.overlap;
  const blocked = unmatchedCodes.length > 0;
  // Suggestions for the ZIP resolver — the markets this run already knows about.
  const markets = [
    ...new Set(
      [
        campaign.settings?.defaultMarket,
        ...Object.keys(campaign.settings?.marketPhones ?? {}),
      ].filter((market): market is string => Boolean(market)),
    ),
  ];

  const chosenReplacements = existing.filter((c) =>
    replaceIds.includes(c.campaignId),
  );
  const overwriteReady = mode === "overwrite" && chosenReplacements.length > 0;

  const commit = () => {
    if (mode === "append") {
      onCommit({ mode: "append" });
      return;
    }
    onCommit({
      mode: "overwrite",
      replaceCampaignIds: replaceIds,
      // Echoed back, never recomputed here: a number that moved since the
      // preview is a 409 the operator must look at, not a delete they did not
      // agree to.
      expectedDeleteCount: overlap.deleteCountIfOverwrite,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* --- Columns ------------------------------------------------------ */}
      {preview.missingRequiredColumns.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>The file is missing required columns</AlertTitle>
          <AlertDescription>
            {preview.missingRequiredColumns.join(", ")}. Nothing can be
            processed without them — upload the vendor's file rather than an
            export of it.
          </AlertDescription>
        </Alert>
      )}

      {preview.missingRecommendedColumns.length > 0 && (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Some recommended columns are absent</AlertTitle>
          <AlertDescription>
            {preview.missingRecommendedColumns.join(", ")}. The run still works;
            a missing <code>controlno</code> means those rows cannot be looked
            up, and a missing <code>yearlyprem</code> means there is nothing to
            discount.
          </AlertDescription>
        </Alert>
      )}

      {/* --- What the transform would do ---------------------------------- */}
      {stats && (
        <Card>
          <CardContent className="flex flex-col gap-4 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-card-foreground">
                {campaign.vendorFile?.name ?? campaign.name}
              </h3>
              <CampaignStatusBadge status={campaign.status} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Rows read" value={formatCount(stats.inputRows)} />
              <StatTile label="Rows out" value={formatCount(stats.outputRows)} />
              <StatTile
                label="Duplicates removed"
                value={formatCount(stats.duplicatesRemoved)}
              />
              <StatTile
                label="Raised to floor"
                value={`${formatCount(stats.floorRaised)} · ${formatRate(preview.floorHitRate)}`}
              />
              <StatTile
                label="ZIPs matched"
                value={formatCount(stats.zipMatched)}
              />
              <StatTile
                label="ZIPs unmatched"
                value={formatCount(stats.zipUnmatched)}
              />
              <StatTile label="No ZIP" value={formatCount(stats.zipEmpty)} />
              <StatTile
                label="Premium (min · avg · max)"
                value={
                  stats.premium
                    ? `${formatMoney(stats.premium.min)} · ${formatMoney(stats.premium.avg)} · ${formatMoney(stats.premium.max)}`
                    : "—"
                }
              />
            </div>

            {preview.inconsistentColumns.length > 0 && (
              /*
               * Information, never an error. Several `agencyid` values is the
               * normal multi-agency case, and the real week-36 file carries two
               * `quotedate`s — rendering this as a problem would train
               * operators to click through it.
               */
              <p className="text-xs text-muted-foreground">
                Columns carrying more than one value across the file:{" "}
                {preview.inconsistentColumns.join(", ")}. Normal for a file
                covering several agencies or quote dates.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* --- Assignment --------------------------------------------------- */}
      <Card>
        <CardContent className="flex flex-col gap-3 px-5 py-4">
          <h3 className="text-sm font-semibold text-card-foreground">
            Assignment
          </h3>
          {preview.assignment.resolved.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The file carries no carrier agency codes.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Code</TableHead>
                    <TableHead>Visible to</TableHead>
                    <TableHead className="w-24 text-right">Rows</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.assignment.resolved.map((row) => (
                    <TableRow key={row.codeKey}>
                      <TableCell className="font-medium">
                        {row.codeKey}
                      </TableCell>
                      <TableCell>
                        {row.agencyName ?? (
                          <span className="text-muted-foreground">
                            {campaign.assignment.mode === "all"
                              ? "All agencies"
                              : "No agency holds this code"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(row.rows)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {blocked && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>
                {unmatchedCodes.length === 1
                  ? "A carrier agency code matches no agency"
                  : "Some carrier agency codes match no agency"}
              </AlertTitle>
              <AlertDescription>
                {unmatchedCodes.join(", ")}. Add the appointment on the agency,
                or switch assignment to "Specific agencies". Filing one agency's
                prospects under another, or dropping them silently, are both
                worse than refusing.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* --- Unmapped ZIPs ------------------------------------------------ */}
      {preview.unmatchedZips.length > 0 && (
        <Card>
          <CardContent className="px-5 py-4">
            <h3 className="mb-3 text-sm font-semibold text-card-foreground">
              ZIPs with no market
            </h3>
            <UnmatchedZipsResolver
              zips={preview.unmatchedZips}
              markets={markets}
              saving={savingZips}
              onSave={onResolveZips}
            />
          </CardContent>
        </Card>
      )}

      {/* --- Existing campaigns ------------------------------------------- */}
      {existing.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3 px-5 py-4">
            <h3 className="text-sm font-semibold text-card-foreground">
              This week already has{" "}
              {existing.length === 1 ? "a campaign" : "campaigns"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {formatCount(overlap.existingInOtherCampaigns)} of this file's rows
              already exist under another campaign.
            </p>

            <RadioGroup
              value={mode}
              onValueChange={(value) =>
                setMode(value as "append" | "overwrite")
              }
              className="gap-3"
            >
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <RadioGroupItem value="append" className="mt-0.5" />
                <span>
                  <span className="font-medium text-foreground">Append</span>
                  <span className="block text-muted-foreground">
                    Rows already imported move to this campaign; nothing is
                    deleted. Leads keep the campaign that produced them.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <RadioGroupItem value="overwrite" className="mt-0.5" />
                <span>
                  <span className="font-medium text-foreground">Overwrite</span>
                  <span className="block text-muted-foreground">
                    Import this file, then delete the rows the replaced
                    campaigns hold that it does not contain. Rows in both files
                    keep their lead links.
                  </span>
                </span>
              </label>
            </RadioGroup>

            <div className="space-y-2 rounded-md bg-sunken px-3 py-2.5">
              {existing.map((conflict) => (
                <label
                  key={conflict.campaignId}
                  className="flex items-center gap-2.5 text-sm"
                >
                  <Checkbox
                    checked={replaceIds.includes(conflict.campaignId)}
                    disabled={mode !== "overwrite"}
                    onCheckedChange={(checked) =>
                      setReplaceIds((previous) =>
                        checked === true
                          ? [...previous, conflict.campaignId]
                          : previous.filter((id) => id !== conflict.campaignId),
                      )
                    }
                    aria-label={`Replace ${conflict.name}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {conflict.name}
                  </span>
                  <Badge size="sm" variant="outline">
                    {formatCampaignNumber(conflict.campaignNumber)}
                  </Badge>
                  <span className="tabular-nums text-muted-foreground">
                    {formatCount(conflict.recordCount)} mailers
                  </span>
                </label>
              ))}
            </div>

            {mode === "overwrite" && (
              <p className="text-sm text-destructive">
                This will delete exactly{" "}
                <strong className="tabular-nums">
                  {formatCount(overlap.deleteCountIfOverwrite)}
                </strong>{" "}
                {overlap.deleteCountIfOverwrite === 1 ? "mailer" : "mailers"}{" "}
                that this file does not contain, and clear the mailer link on
                any lead that pointed at them.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* --- Rejections --------------------------------------------------- */}
      {/* `total` is unknown here on purpose — see `RejectionsTable`. */}
      <RejectionsTable rejections={preview.rejections} total={null} />

      {/* --- Commit ------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={
            committing ||
            savingZips ||
            blocked ||
            (mode === "overwrite" && !overwriteReady)
          }
          onClick={() => (mode === "overwrite" ? setConfirmOpen(true) : commit())}
        >
          {committing && <Loader2 className="size-4 animate-spin" />}
          {mode === "overwrite" ? (
            <>
              <Trash2 className="size-4" />
              Overwrite and import
            </>
          ) : (
            <>
              <CheckCircle2 className="size-4" />
              {/*
               * "rows", not "mailers", and deliberately not `outputRows` minus
               * the rejections: `preview.rejections` is a capped sample, so the
               * real skip count is not knowable until the import runs. Naming
               * the transform's own output is a number that is exactly true;
               * subtracting a sample from it would be a number that is usually
               * wrong.
               */}
              Import {formatCount(stats?.outputRows ?? null)}{" "}
              {stats?.outputRows === 1 ? "row" : "rows"}
            </>
          )}
        </Button>
        {blocked && (
          <p className="text-sm text-muted-foreground">
            Resolve the carrier codes above first.
          </p>
        )}
        {mode === "overwrite" && !overwriteReady && (
          <p className="text-sm text-muted-foreground">
            Tick the campaigns this run replaces.
          </p>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {formatCount(overlap.deleteCountIfOverwrite)}{" "}
              {overlap.deleteCountIfOverwrite === 1 ? "mailer" : "mailers"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This deletes exactly {formatCount(overlap.deleteCountIfOverwrite)}{" "}
              {overlap.deleteCountIfOverwrite === 1 ? "mailer" : "mailers"} from{" "}
              {chosenReplacements.map((c) => c.name).join(", ")} that are not in
              this file, and clears the mailer link on any lead pointing at
              them. Rows in both files keep their links.{" "}
              {chosenReplacements.length === 1
                ? "That campaign is"
                : "Those campaigns are"}{" "}
              then marked superseded rather than removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={committing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={committing}
              onClick={(event) => {
                // Keep the dialog up while the request is in flight — Radix
                // closes on click otherwise, and a commit that 409s would
                // report against a dialog nobody can see.
                event.preventDefault();
                commit();
              }}
            >
              {committing && <Loader2 className="size-4 animate-spin" />}
              Overwrite and import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
