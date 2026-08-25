import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileDropzone } from "@/components/upload/FileDropzone";
import { listAgencies } from "@/lib/platform-api";
import {
  ALLOWED_MAILER_EXTENSIONS,
  ALLOWED_MAILER_TYPES,
  MAX_MAILER_FILE_BYTES,
  commitMailerImport,
  getMailerImport,
  isMailerImportSettled,
  startMailerImport,
  type MailerImportRun,
} from "@/lib/platform-mailers-api";
import { SuperAdminLayout } from "./SuperAdminLayout";
import { ImportReport } from "./components/ImportReport";

/** How often to re-read a working run. */
const POLL_MS = 1500;

/**
 * Add Mailers (PAC-73): pick an agency, upload its RTP file, preview, commit.
 *
 * ## Why there is a preview step at all
 *
 * The commit writes tens of thousands of documents into a live tenant, and the
 * only signal that the operator picked the wrong agency is inside the file. So
 * the file is parsed first, reported on, and written only after someone has
 * looked at what it contains. Cancelling writes nothing.
 *
 * ## Why this polls
 *
 * Both the parse and the write run as Inngest jobs rather than in the request —
 * the reference file is 23 MB and an HTTP timeout is not a size limit worth
 * having. The run record is the state; this reads it until it settles.
 *
 * ⚠ **Temporary.** PAC-71 folds this into Mailer Campaigns and deletes it. The
 * work that matters is the importer, which lives server-side and is called from
 * three places; this page is a thin driver over two endpoints.
 */
export default function AddMailersPage() {
  const queryClient = useQueryClient();
  const [agencyId, setAgencyId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const agenciesQuery = useQuery({
    queryKey: ["platform", "agencies"],
    queryFn: listAgencies,
  });

  const runQuery = useQuery({
    queryKey: ["platform", "mailer-import", runId],
    queryFn: () => getMailerImport(runId as string),
    enabled: runId !== null,
    // Stop the moment the run reaches a state a human has to act on.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isMailerImportSettled(status) ? false : POLL_MS;
    },
    /**
     * Keep polling while the tab is in the background.
     *
     * TanStack Query pauses `refetchInterval` whenever `document.hidden` is
     * true. For a job that can run for minutes over a 23 MB file, that means an
     * operator who switches tabs comes back to a spinner that never resolves —
     * the run finished, but nothing asked. Worse, the query is still inside its
     * 30s `staleTime`, so even remounting does not necessarily refetch.
     *
     * The cost is one small request every 1.5s in a hidden tab, and it stops as
     * soon as the run settles.
     */
    refetchIntervalInBackground: true,
  });

  const run = runQuery.data ?? null;
  useSettledToast(run);

  const startMutation = useMutation({
    mutationFn: () =>
      startMailerImport({ agencyId, file: file as File }),
    onSuccess: (created) => {
      setRunId(created.id);
      queryClient.setQueryData(
        ["platform", "mailer-import", created.id],
        created,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const commitMutation = useMutation({
    mutationFn: (confirmAgencyMismatch: boolean) =>
      commitMailerImport(runId as string, { confirmAgencyMismatch }),
    onSuccess: (updated) =>
      queryClient.setQueryData(
        ["platform", "mailer-import", updated.id],
        updated,
      ),
    onError: (error: Error) => toast.error(error.message),
  });

  const reset = () => {
    setRunId(null);
    setFile(null);
  };

  const agencies = agenciesQuery.data ?? [];
  const selectedAgency = agencies.find((a) => a._id === agencyId);
  const working =
    run?.status === "previewing" || run?.status === "importing";

  return (
    <SuperAdminLayout>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 gap-1">
        <Link to="/admin">
          <ArrowLeft className="size-4" />
          All areas
        </Link>
      </Button>

      <div className="mb-6">
        <h2 className="text-sm font-semibold text-card-foreground">
          Add mailers
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload an agency's RTP final file. Nothing is written until you review
          the preview and commit.
        </p>
      </div>

      {run === null ? (
        <Card>
          <CardContent className="flex flex-col gap-5 px-5 py-4">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="agency"
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                Agency
              </label>
              {/*
                Chosen explicitly, never inferred from the filename. The file's
                own `agencyid` is only ever cross-checked against this.
              */}
              <Select value={agencyId} onValueChange={setAgencyId}>
                <SelectTrigger id="agency" className="w-full sm:w-[320px]">
                  <SelectValue
                    placeholder={
                      agenciesQuery.isPending
                        ? "Loading agencies…"
                        : "Select an agency"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {agencies.map((agency) => (
                    <SelectItem key={agency._id} value={agency._id}>
                      {agency.name}
                      {agency.ticker ? ` (${agency.ticker})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAgency && !selectedAgency.allstateAgencyId && (
                <p className="text-xs text-muted-foreground">
                  This agency has no Allstate agency id on record, so the file's
                  own agency cannot be cross-checked.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                RTP file
              </span>
              <FileDropzone
                accept={ALLOWED_MAILER_TYPES}
                acceptExtensions={ALLOWED_MAILER_EXTENSIONS}
                maxBytes={MAX_MAILER_FILE_BYTES}
                file={file}
                onSelect={setFile}
                hint="CSV up to 100MB"
                disabled={startMutation.isPending}
                aria-label="Upload an RTP file"
              />
            </div>

            <div className="flex items-center gap-3">
              <Button
                disabled={!agencyId || !file || startMutation.isPending}
                onClick={() => startMutation.mutate()}
              >
                {startMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {startMutation.isPending ? "Uploading…" : "Upload and preview"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Step 1 of 2 — this writes no mailers.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ImportReport
          run={run}
          agencyName={selectedAgency?.name}
          working={working}
          committing={commitMutation.isPending}
          onCommit={(confirm) => commitMutation.mutate(confirm)}
          onReset={reset}
        />
      )}
    </SuperAdminLayout>
  );
}

/**
 * Announce a run reaching a terminal state exactly once.
 *
 * The run object is re-fetched on a poll, so reacting to it directly would fire
 * a toast on every tick after it settles. Keyed on `id + status` because one run
 * settles twice — at `previewed` and again at `completed`.
 */
function useSettledToast(run: MailerImportRun | null): void {
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!run || !isMailerImportSettled(run.status)) return;
    const key = `${run.id}:${run.status}`;
    if (announced.current === key) return;
    announced.current = key;

    if (run.status === "failed") {
      toast.error(run.error ?? "The import failed.");
    } else if (run.status === "completed") {
      const created = run.counts?.created ?? 0;
      const updated = run.counts?.updated ?? 0;
      toast.success(
        `Imported ${created.toLocaleString()} new and ` +
          `${updated.toLocaleString()} updated ` +
          `${created + updated === 1 ? "mailer" : "mailers"}.`,
      );
    }
  }, [run]);
}
