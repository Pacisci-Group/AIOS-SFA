import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import type {
  MailerCampaign,
  MailerCampaignSettings,
  MailerCommitRequest,
} from "@sfa/shared";
import { FormError } from "@/components/form";
import { StepProgress } from "@/components/common/StepProgress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileDropzone } from "@/components/upload/FileDropzone";
import { useAppForm, withForm } from "@/hooks/form";
import { ApiError } from "@/lib/api-client";
import { openDocumentInNewTab } from "@/lib/open-document";
import { listAgencies, type PlatformAgency } from "@/lib/platform-api";
import {
  ALLOWED_CAMPAIGN_FILE_EXTENSIONS,
  ALLOWED_CAMPAIGN_FILE_TYPES,
  MAX_CAMPAIGN_FILE_BYTES,
  campaignDefaultsKey,
  campaignKey,
  campaignsKey,
  commitCampaign,
  createCampaign,
  emailCampaignOutput,
  getCampaign,
  getCampaignDefaults,
  getCampaignFileUrl,
  isCampaignSettled,
  updateCampaign,
} from "@/lib/platform-campaigns-api";
import { SuperAdminLayout } from "../SuperAdminLayout";
import { CampaignPreviewReport } from "./components/CampaignPreviewReport";
import { CampaignSettingsForm } from "./components/CampaignSettingsForm";
import { RejectionsTable } from "./components/RejectionsTable";
import { StatTile } from "./components/StatTile";
import {
  EMPTY_CAMPAIGN_FORM,
  campaignFormSchema,
  fromDefaults,
  toCampaignSettings,
  type CampaignFormValues,
} from "./campaign-schemas";
import { formatCount } from "./campaign-format";

/** How often to re-read a working campaign. */
const POLL_MS = 1500;

const STEPS = ["Settings and file", "Preview", "Outcome"] as const;

/**
 * Run a campaign (PAC-71) — settings, then a preview of what the file contains,
 * then what was written.
 *
 * ## Why three steps and not one page
 *
 * The commit writes tens of thousands of mailers and can *delete* thousands
 * more, and the only evidence that the settings are right is inside the file.
 * So the file is transformed first, reported on, and written only after somebody
 * has looked. Cancelling at step 2 writes nothing.
 *
 * ## Why this polls
 *
 * Both the preview and the commit run as Inngest jobs rather than in the
 * request — the real vendor file is 20,024 rows and an HTTP timeout is not a
 * size limit worth having. The campaign record is the state; this reads it until
 * it settles.
 *
 * `?source=processed` runs the same three steps over a file somebody else
 * already processed (the old Add Mailers flow, kept as the recovery path): the
 * transform is skipped, so the pricing controls are hidden and there are no
 * processor stats to show. `?campaignId=` resumes an existing run at step 2.
 */
export default function RunCampaignPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const source = params.get("source") === "processed" ? "processed" : "vendor";
  const resumeId = params.get("campaignId");

  const [file, setFile] = useState<File | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(resumeId);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const agenciesQuery = useQuery({
    queryKey: ["platform", "agencies"],
    queryFn: listAgencies,
  });

  const campaignQuery = useQuery({
    queryKey: campaignKey(campaignId ?? ""),
    queryFn: () => getCampaign(campaignId as string),
    enabled: campaignId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isCampaignSettled(status) ? false : POLL_MS;
    },
    /**
     * Keep polling while the tab is in the background.
     *
     * TanStack Query pauses `refetchInterval` whenever `document.hidden` is
     * true. For a job that runs for minutes over a 23 MB file, that means an
     * operator who switches tabs comes back to a spinner that never resolves —
     * the job finished, but nothing asked.
     */
    refetchIntervalInBackground: true,
  });

  const campaign = campaignQuery.data ?? null;
  useSettledToast(campaign);

  const create = useMutation({
    mutationFn: (values: CampaignFormValues) =>
      createCampaign({
        file: file as File,
        name: values.name.trim() || undefined,
        source,
        campaignNumber: values.campaignNumber.trim() || undefined,
        assignment: values.assignment,
        settings: toCampaignSettings(values),
      }),
    onSuccess: (created) => {
      setCampaignId(created.id);
      queryClient.setQueryData(campaignKey(created.id), created);
      void queryClient.invalidateQueries({ queryKey: campaignsKey });
    },
    onError: (error: Error) => {
      setSubmitError(
        error instanceof ApiError
          ? error.message
          : "Could not start the campaign. Try again.",
      );
    },
  });

  /**
   * Save the ZIP answers and re-preview.
   *
   * A `PATCH` rather than its own endpoint: the resolutions are part of the
   * settings snapshot the run is reproducible from, and the server writes them
   * into the platform table on the way past.
   */
  const resolveZips = useMutation({
    mutationFn: (zipResolutions: Record<string, string>) => {
      const settings = campaign?.settings;
      if (!settings) throw new Error("This campaign has no settings to update.");
      const merged: MailerCampaignSettings = {
        ...settings,
        zipResolutions: { ...settings.zipResolutions, ...zipResolutions },
      };
      return updateCampaign(campaign.id, { settings: merged });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(campaignKey(updated.id), updated);
      toast.success("Saved. Re-reading the file with the new markets…");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const commit = useMutation({
    mutationFn: (request: MailerCommitRequest) =>
      commitCampaign(campaign?.id as string, request),
    onSuccess: (updated) => {
      queryClient.setQueryData(campaignKey(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: campaignsKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sendEmail = useMutation({
    mutationFn: () => emailCampaignOutput(campaign?.id as string),
    onSuccess: (result) =>
      toast.success(
        `Queued for ${result.queued} ${result.queued === 1 ? "recipient" : "recipients"}.`,
      ),
    onError: (error: Error) => toast.error(error.message),
  });

  const stepIndex = campaign
    ? campaign.status === "imported"
      ? 2
      : 1
    : 0;

  return (
    <SuperAdminLayout>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 gap-1">
        <Link to="/admin/campaigns">
          <ArrowLeft className="size-4" />
          All campaigns
        </Link>
      </Button>

      <StepProgress
        step={stepIndex + 1}
        total={STEPS.length}
        title={
          source === "processed" ? "Import a processed file" : "Run a campaign"
        }
        description={STEPS[stepIndex]}
        sticky={false}
      />

      <div className="mt-4">
        {campaign === null ? (
          <SetupStep
            agencies={agenciesQuery.data ?? []}
            source={source}
            file={file}
            onSelectFile={setFile}
            error={submitError}
            submitting={create.isPending}
            onSubmit={(values) => {
              setSubmitError(null);
              create.mutate(values);
            }}
          />
        ) : campaign.status === "imported" ? (
          <OutcomeStep
            campaign={campaign}
            emailing={sendEmail.isPending}
            onEmail={() => sendEmail.mutate()}
            onDone={() => navigate(`/admin/campaigns/${campaign.id}`)}
          />
        ) : (
          <WorkingOrPreview
            campaign={campaign}
            savingZips={resolveZips.isPending}
            committing={commit.isPending}
            onResolveZips={(values) => resolveZips.mutate(values)}
            onCommit={(request) => commit.mutate(request)}
          />
        )}
      </div>
    </SuperAdminLayout>
  );
}

// ---------------------------------------------------------------------------
// Step 1
// ---------------------------------------------------------------------------

interface SetupStepProps {
  agencies: readonly PlatformAgency[];
  source: "vendor" | "processed";
  file: File | null;
  onSelectFile: (file: File | null) => void;
  error: string | null;
  submitting: boolean;
  onSubmit: (values: CampaignFormValues) => void;
}

/**
 * Load the defaults, *then* build the form from them.
 *
 * ⚠ Two components rather than one, and the split is load-bearing. Seeding a
 * mounted form with `form.reset(...)` propagates to scalar fields but leaves an
 * array field — the discount bands and the market phones — rendering the zero
 * rows it mounted with, so the run would go out with no square-footage table at
 * all. Mounting the form only once its real values exist makes the ordering
 * impossible to get wrong instead of relying on a reset landing.
 *
 * The skeleton is the same guarantee in the other direction: an empty
 * `premiumFloor` is a run priced from the discount table alone, on ~20,000 mail
 * pieces, so there is never a moment where a blank one is on screen.
 */
function SetupStep(props: SetupStepProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: campaignDefaultsKey,
    queryFn: getCampaignDefaults,
    // The values only move when a campaign imports, and the wizard reads them
    // once — a refetch mid-run must not rewrite the form under the operator.
    staleTime: Infinity,
  });

  if (isPending) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return <FormError>Couldn't load the campaign defaults. Reload to retry.</FormError>;
  }

  return <SetupForm initial={fromDefaults(data)} {...props} />;
}

function SetupForm({
  initial,
  onSubmit,
  ...rest
}: SetupStepProps & { initial: CampaignFormValues }) {
  const form = useAppForm({
    defaultValues: initial,
    validators: { onBlur: campaignFormSchema },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return <SettingsStep form={form} {...rest} />;
}

const SettingsStep = withForm({
  defaultValues: EMPTY_CAMPAIGN_FORM,
  props: {
    agencies: [] as readonly PlatformAgency[],
    source: "vendor" as "vendor" | "processed",
    file: null as File | null,
    onSelectFile: (_file: File | null) => {},
    error: null as string | null,
    submitting: false,
  },
  render: function Render({
    form,
    agencies,
    source,
    file,
    onSelectFile,
    error,
    submitting,
  }) {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Card>
          <CardContent className="flex flex-col gap-2 px-5 py-4">
            <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
              {source === "processed" ? "Processed file" : "Vendor file"}
            </span>
            <FileDropzone
              accept={ALLOWED_CAMPAIGN_FILE_TYPES}
              acceptExtensions={ALLOWED_CAMPAIGN_FILE_EXTENSIONS}
              maxBytes={MAX_CAMPAIGN_FILE_BYTES}
              file={file}
              onSelect={onSelectFile}
              hint="XLSX or CSV up to 100MB"
              disabled={submitting}
              aria-label="Upload the mail file"
            />
            <p className="text-xs text-muted-foreground">
              {source === "processed"
                ? "A file already run through the processor. It is imported as it stands — no transform, no output file."
                : "The presorted, mail-ready file the data/print vendor returned. We run the transform."}
            </p>
          </CardContent>
        </Card>

        <CampaignSettingsForm
          form={form}
          agencies={agencies}
          source={source}
          disabled={submitting}
        />

        <FormError>{error}</FormError>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={!file || submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? "Uploading…" : "Upload and preview"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Step 1 of 3 — this writes no mailers.
          </p>
        </div>
      </form>
    );
  },
});

// ---------------------------------------------------------------------------
// Step 2
// ---------------------------------------------------------------------------

function WorkingOrPreview({
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
  if (campaign.status === "failed") {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>The run failed</AlertTitle>
          <AlertDescription>
            {campaign.error ?? "No further detail was recorded."}
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link to={`/admin/campaigns/${campaign.id}`}>
            Open the campaign to retry
          </Link>
        </Button>
      </div>
    );
  }

  if (campaign.status !== "previewed") {
    return (
      <Alert>
        <Loader2 className="size-4 animate-spin" />
        <AlertTitle>
          {campaign.status === "processing"
            ? "Importing mailers…"
            : "Reading the file…"}
        </AlertTitle>
        <AlertDescription>
          {campaign.status === "processing"
            ? "This keeps running if you close the tab."
            : "Nothing has been written yet."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <CampaignPreviewReport
      campaign={campaign}
      savingZips={savingZips}
      committing={committing}
      onResolveZips={onResolveZips}
      onCommit={onCommit}
    />
  );
}

// ---------------------------------------------------------------------------
// Step 3
// ---------------------------------------------------------------------------

function OutcomeStep({
  campaign,
  emailing,
  onEmail,
  onDone,
}: {
  campaign: MailerCampaign;
  emailing: boolean;
  onEmail: () => void;
  onDone: () => void;
}) {
  const counts = campaign.importCounts;

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <CheckCircle2 className="size-4 text-success" />
        <AlertTitle>Import complete</AlertTitle>
        <AlertDescription>
          Producers in every agency this campaign is visible to can now look
          these mailers up by either control-number form.
        </AlertDescription>
      </Alert>

      {counts && (
        <Card>
          <CardContent className="px-5 py-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile label="Rows read" value={formatCount(counts.read)} />
              <StatTile label="Created" value={formatCount(counts.created)} />
              <StatTile label="Updated" value={formatCount(counts.updated)} />
              <StatTile label="Skipped" value={formatCount(counts.skipped)} />
              <StatTile label="Deleted" value={formatCount(counts.deleted)} />
              <StatTile
                label="Leads linked"
                value={
                  counts.leadsConflicted > 0
                    ? `${formatCount(counts.leadsLinked)} · ${formatCount(counts.leadsConflicted)} conflicted`
                    : formatCount(counts.leadsLinked)
                }
              />
            </div>
            {counts.leadsConflicted > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                A conflicted lead carried a control number that matched several
                candidate leads, or lost the mailer to one logged from the
                drawer. Reported rather than linked — an arbitrary link is worse
                than none.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <RejectionsTable
        rejections={campaign.rejections}
        total={counts?.skipped ?? null}
      />

      <div className="flex flex-wrap items-center gap-3">
        {campaign.outputFile && (
          <Button
            variant="outline"
            className="gap-1"
            onClick={() =>
              void openDocumentInNewTab(() =>
                getCampaignFileUrl(campaign.id, "output").then((r) => r.url),
              )
            }
          >
            <Download className="size-4" />
            Download output
          </Button>
        )}
        {campaign.outputFile && (
          <Button
            variant="outline"
            className="gap-1"
            disabled={emailing}
            onClick={onEmail}
          >
            {emailing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Mail className="size-4" />
            )}
            Email the output
          </Button>
        )}
        <Button onClick={onDone}>Open the campaign</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Announce a campaign reaching a terminal state exactly once.
 *
 * The record is re-fetched on a poll, so reacting to it directly would fire a
 * toast on every tick after it settles. Keyed on `id + status` because one
 * campaign settles twice — at `previewed` and again at `imported`.
 */
function useSettledToast(campaign: MailerCampaign | null): void {
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!campaign || !isCampaignSettled(campaign.status)) return;
    const key = `${campaign.id}:${campaign.status}`;
    if (announced.current === key) return;
    announced.current = key;

    if (campaign.status === "failed") {
      toast.error(campaign.error ?? "The run failed.");
    } else if (campaign.status === "imported") {
      const created = campaign.importCounts?.created ?? 0;
      toast.success(
        `Imported ${created.toLocaleString()} ${created === 1 ? "mailer" : "mailers"}.`,
      );
    }
  }, [campaign]);
}
