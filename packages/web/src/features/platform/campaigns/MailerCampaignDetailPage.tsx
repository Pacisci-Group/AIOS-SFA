import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Loader2,
  Mail,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import type { MailerCampaign } from "@sfa/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { openDocumentInNewTab } from "@/lib/open-document";
import {
  campaignKey,
  emailCampaignOutput,
  getCampaign,
  getCampaignFileUrl,
  isCampaignSettled,
} from "@/lib/platform-campaigns-api";
import { SuperAdminLayout } from "../SuperAdminLayout";
import { CampaignStatusBadge } from "./CampaignStatusBadge";
import { CampaignRecordsTable } from "./components/CampaignRecordsTable";
import { RejectionsTable } from "./components/RejectionsTable";
import { StatTile } from "./components/StatTile";
import {
  ASSIGNMENT_MODE_LABELS,
  formatBytes,
  formatCampaignNumber,
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRate,
} from "./campaign-format";

const POLL_MS = 1500;

/**
 * One campaign, end to end (PAC-71): both stored files, the settings it ran
 * with, what the transform did, who it reaches, and the mailers it owns.
 *
 * The reason a campaign is a record rather than a job log: a run must be
 * reproducible from its own document, and `Lead.mailer.campaignId` points here
 * for as long as the lead exists. That is also why a `superseded` campaign is
 * still a page — it lost its mailers to an overwrite, not its attribution.
 */
export default function MailerCampaignDetailPage() {
  const { campaignId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: campaign, isPending, isError } = useQuery({
    queryKey: campaignKey(campaignId),
    queryFn: () => getCampaign(campaignId),
    // A campaign opened while its commit is running should finish in front of
    // the operator rather than needing a refresh.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isCampaignSettled(status) ? false : POLL_MS;
    },
    refetchIntervalInBackground: true,
  });

  const sendEmail = useMutation({
    mutationFn: () => emailCampaignOutput(campaignId),
    onSuccess: (result) => {
      toast.success(
        `Queued for ${result.queued} ${result.queued === 1 ? "recipient" : "recipients"}.`,
      );
      void queryClient.invalidateQueries({ queryKey: campaignKey(campaignId) });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <SuperAdminLayout>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 gap-1">
        <Link to="/admin/campaigns">
          <ArrowLeft className="size-4" />
          All campaigns
        </Link>
      </Button>

      {isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Couldn't load this campaign</AlertTitle>
          <AlertDescription>
            It may have been deleted before it imported.
          </AlertDescription>
        </Alert>
      ) : isPending || !campaign ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/5" />
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Header campaign={campaign} />

          {campaign.status === "failed" && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>The run failed</AlertTitle>
              <AlertDescription>
                {campaign.error ?? "No further detail was recorded."}
              </AlertDescription>
            </Alert>
          )}

          {campaign.supersededByCampaignId && (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle>Superseded</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                A later run replaced this campaign's mailers. Leads already
                attributed to it keep pointing here.
                <Button asChild variant="outline" size="xs">
                  <Link
                    to={`/admin/campaigns/${campaign.supersededByCampaignId}`}
                  >
                    Open the replacement
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Files campaign={campaign} />

          {campaign.stats && (
            <Section title="What the transform did">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile
                  label="Rows read"
                  value={formatCount(campaign.stats.inputRows)}
                />
                <StatTile
                  label="Rows out"
                  value={formatCount(campaign.stats.outputRows)}
                />
                <StatTile
                  label="Duplicates removed"
                  value={formatCount(campaign.stats.duplicatesRemoved)}
                />
                <StatTile
                  label="Raised to floor"
                  value={`${formatCount(campaign.stats.floorRaised)}${
                    campaign.preview
                      ? ` · ${formatRate(campaign.preview.floorHitRate)}`
                      : ""
                  }`}
                />
                <StatTile
                  label="ZIPs matched"
                  value={formatCount(campaign.stats.zipMatched)}
                />
                <StatTile
                  label="ZIPs unmatched"
                  value={formatCount(campaign.stats.zipUnmatched)}
                />
                <StatTile
                  label="No ZIP"
                  value={formatCount(campaign.stats.zipEmpty)}
                />
                <StatTile
                  label="Premium (min · avg · max)"
                  value={
                    campaign.stats.premium
                      ? `${formatMoney(campaign.stats.premium.min)} · ${formatMoney(campaign.stats.premium.avg)} · ${formatMoney(campaign.stats.premium.max)}`
                      : "—"
                  }
                />
              </div>
            </Section>
          )}

          <Assignment campaign={campaign} />

          {campaign.settings && <Settings campaign={campaign} />}

          {campaign.importCounts && (
            <Section title="Import outcome">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatTile
                  label="Created"
                  value={formatCount(campaign.importCounts.created)}
                />
                <StatTile
                  label="Updated"
                  value={formatCount(campaign.importCounts.updated)}
                />
                <StatTile
                  label="Skipped"
                  value={formatCount(campaign.importCounts.skipped)}
                />
                <StatTile
                  label="Deleted"
                  value={formatCount(campaign.importCounts.deleted)}
                />
                <StatTile
                  label="Leads linked"
                  value={formatCount(campaign.importCounts.leadsLinked)}
                />
                <StatTile
                  label="Leads conflicted"
                  value={formatCount(campaign.importCounts.leadsConflicted)}
                />
              </div>
            </Section>
          )}

          <RejectionsTable
            rejections={campaign.rejections}
            total={campaign.importCounts?.skipped ?? null}
          />

          <Section title="Records">
            <CampaignRecordsTable campaignId={campaign.id} />
          </Section>

          <div className="flex flex-wrap items-center gap-3">
            {campaign.status === "imported" && campaign.outputFile && (
              <Button
                variant="outline"
                className="gap-1"
                disabled={sendEmail.isPending}
                onClick={() => sendEmail.mutate()}
              >
                {sendEmail.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                Email the output
              </Button>
            )}
            {(campaign.status === "previewed" ||
              campaign.status === "failed") && (
              <Button
                className="gap-1"
                onClick={() =>
                  navigate(
                    `/admin/campaigns/new?campaignId=${campaign.id}${
                      campaign.source === "processed"
                        ? "&source=processed"
                        : ""
                    }`,
                  )
                }
              >
                <Play className="size-4" />
                Resume this run
              </Button>
            )}
          </div>
        </div>
      )}
    </SuperAdminLayout>
  );
}

// ---------------------------------------------------------------------------

function Header({ campaign }: { campaign: MailerCampaign }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-card-foreground">
            {campaign.name}
          </h2>
          <CampaignStatusBadge status={campaign.status} />
          {campaign.source === "processed" && (
            <Badge size="sm" variant="outline">
              Processed file
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatCampaignNumber(campaign.campaignNumber)}
          {campaign.year ? ` · ${campaign.year}` : ""} ·{" "}
          {campaign.carrierName ?? "Unknown carrier"} · quoted{" "}
          {formatDate(campaign.quoteDate)}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Run by {campaign.requestedByName ?? "System"} on{" "}
          {formatDateTime(campaign.createdAt)}
          {campaign.finishedAt
            ? `, finished ${formatDateTime(campaign.finishedAt)}`
            : ""}
        </p>
      </div>
    </div>
  );
}

/**
 * Both stored files, each behind a click rather than an `href`.
 *
 * The URL is a short-lived presigned GET minted on demand — a key is a
 * capability, so the campaign DTO never carries one and the link cannot be
 * followed by anything that happens to prefetch the route.
 */
function Files({ campaign }: { campaign: MailerCampaign }) {
  const files = [
    { kind: "vendor" as const, label: "Vendor file", file: campaign.vendorFile },
    { kind: "output" as const, label: "Output file", file: campaign.outputFile },
  ].filter((entry) => entry.file);

  if (files.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {files.map(({ kind, label, file }) => (
        <Card key={kind}>
          <CardContent className="flex items-center gap-3 px-4 py-3">
            <FileSpreadsheet className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] tracking-widest text-muted-foreground uppercase">
                {label}
              </p>
              <p className="truncate text-sm text-foreground">{file?.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file?.size ?? 0)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Download the ${label.toLowerCase()}`}
              onClick={() =>
                void openDocumentInNewTab(() =>
                  getCampaignFileUrl(campaign.id, kind).then((r) => r.url),
                )
              }
            >
              <Download className="size-4" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Assignment({ campaign }: { campaign: MailerCampaign }) {
  const resolved = campaign.preview?.assignment.resolved ?? [];

  return (
    <Section title="Assignment">
      <p className="mb-3 text-sm text-muted-foreground">
        {ASSIGNMENT_MODE_LABELS[campaign.assignment.mode]}
        {campaign.assignment.mode === "all" &&
          " — including agencies onboarded after this run."}
      </p>
      {resolved.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {campaign.carrierAgencyIds.length > 0
            ? `Carrier agency codes in the file: ${campaign.carrierAgencyIds.join(", ")}.`
            : "The file carried no carrier agency codes."}
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
              {resolved.map((row) => (
                <TableRow key={row.codeKey}>
                  <TableCell className="font-medium">{row.codeKey}</TableCell>
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
    </Section>
  );
}

/**
 * The settings snapshot.
 *
 * ⚠ What the run *actually used*, not the current defaults. Editing a rule
 * afterwards never changes what a completed run means, which is the whole
 * reason there is no settings collection.
 */
function Settings({ campaign }: { campaign: MailerCampaign }) {
  const settings = campaign.settings;
  if (!settings) return null;

  const bands = settings.discounts.squareFootage
    .map(
      (band) =>
        `${band.minSquareFeet.toLocaleString()}+ sq ft → ${(band.rate * 100).toFixed(0)}%`,
    )
    .join(", ");

  return (
    <Section title="Settings this run used">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Detail label="Premium floor">{formatMoney(settings.premiumFloor)}</Detail>
        <Detail label="Run year">{settings.runYear}</Detail>
        <Detail label="File name column">{settings.fileName}</Detail>
        <Detail label="Default market">
          {settings.defaultMarket} · {settings.defaultPhone}
        </Detail>
        <Detail label="Square-footage discounts">{bands || "—"}</Detail>
        <Detail label="Home-age discount">
          {`≤ ${settings.discounts.homeAge.maxNewYears} years → ${(settings.discounts.homeAge.newRate * 100).toFixed(0)}%, older → ${(settings.discounts.homeAge.oldRate * 100).toFixed(0)}%`}
        </Detail>
        <Detail label="Market phones">
          {Object.entries(settings.marketPhones)
            .map(([market, phone]) => `${market} → ${phone}`)
            .join(", ") || "—"}
        </Detail>
        <Detail label="Output recipients">
          {settings.outputRecipients.join(", ") || "—"}
        </Detail>
        {Object.keys(settings.zipResolutions).length > 0 && (
          <Detail label="ZIPs resolved in preview">
            {Object.entries(settings.zipResolutions)
              .map(([zip, market]) => `${zip} → ${market}`)
              .join(", ")}
          </Detail>
        )}
      </dl>
    </Section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="px-5 py-4">
        <h3 className="mb-3 text-sm font-semibold text-card-foreground">
          {title}
        </h3>
        {children}
      </CardContent>
    </Card>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}
