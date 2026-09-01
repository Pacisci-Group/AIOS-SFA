import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  BUG_REPORT_STATUSES,
  BUG_REPORT_STATUS_LABELS,
  BUG_SEVERITY_LABELS,
  MAX_BUG_INTERNAL_NOTES_LENGTH,
  type BugReportStatus,
} from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { getBugReport, updateBugReport } from "@/lib/platform-bug-reports-api";
import {
  BUG_SEVERITY_VARIANT,
  BUG_STATUS_VARIANT,
  formatSize,
  relativeTime,
} from "./bug-report-display";

interface BugReportDetailSheetProps {
  /** `null` closes the sheet. */
  reportId: string | null;
  onClose: () => void;
}

/** One `label: value` row in the captured-context block. */
function ContextRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex gap-2 py-0.5">
      <dt className="w-24 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-xs text-foreground">
        {value ?? "—"}
      </dd>
    </div>
  );
}

/**
 * One bug report in full, with the triage controls.
 *
 * ## Why a sheet and not a route
 *
 * Triage is a pass down a queue: read one, set a status, move to the next. A
 * route per report would push the filtered list off screen and make "back" the
 * primary navigation. The list stays put behind this.
 *
 * ## Screenshot URLs expire
 *
 * The API signs each screenshot as a short-lived inline GET
 * (`screenshotUrlExpiresIn`, 300s by default). `staleTime` below is pinned
 * under that so a sheet reopened later re-signs rather than rendering broken
 * images, and `refetchOnWindowFocus` covers the operator who leaves the tab.
 */
export function BugReportDetailSheet({
  reportId,
  onClose,
}: BugReportDetailSheetProps) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  /** Notes the operator has edited but not saved — guards the reset below. */
  const [notesDirty, setNotesDirty] = useState(false);

  const query = useQuery({
    queryKey: ["platform", "bug-report", reportId],
    queryFn: () => getBugReport(reportId as string),
    enabled: reportId !== null,
    // Comfortably under the 300s presign TTL — see the docblock.
    staleTime: 120_000,
    refetchOnWindowFocus: true,
  });

  const report = query.data ?? null;

  /*
   * Seed the notes box from the server, but never clobber an unsaved edit — a
   * background refetch landing mid-sentence would otherwise wipe what the
   * operator was typing. Reset the dirty flag when the sheet switches reports.
   */
  useEffect(() => {
    setNotes("");
    setNotesDirty(false);
  }, [reportId]);

  useEffect(() => {
    if (report && !notesDirty) setNotes(report.internalNotes ?? "");
  }, [report, notesDirty]);

  const save = useMutation({
    mutationFn: (patch: { status?: BugReportStatus; internalNotes?: string }) =>
      updateBugReport(reportId as string, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(["platform", "bug-report", updated.id], updated);
      // The row's status badge and the filter chip counts both move.
      void queryClient.invalidateQueries({
        queryKey: ["platform", "bug-reports"],
      });
      setNotesDirty(false);
      toast.success("Bug report updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const notesChanged = report ? notes !== (report.internalNotes ?? "") : false;

  return (
    <Sheet open={reportId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Bug report</SheetTitle>
          <SheetDescription>
            {report
              ? `${report.reporterName ?? report.reporterEmail} · ${
                  report.agencyName ?? "Platform"
                } · ${relativeTime(report.createdAt)}`
              : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        {query.isPending && (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading report…
          </div>
        )}

        {query.isError && (
          <p className="px-4 py-8 text-sm text-destructive">
            {(query.error as Error).message}
          </p>
        )}

        {report && (
          <div className="space-y-5 px-4 pb-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge size="sm" variant={BUG_STATUS_VARIANT[report.status]}>
                {BUG_REPORT_STATUS_LABELS[report.status]}
              </Badge>
              <Badge size="sm" variant={BUG_SEVERITY_VARIANT[report.severity]}>
                {BUG_SEVERITY_LABELS[report.severity]}
              </Badge>
            </div>

            <section>
              <h3 className="text-sm font-semibold text-card-foreground">
                What happened
              </h3>
              {/* `whitespace-pre-wrap`: reporters use line breaks to separate
                  steps, and collapsing them turns a reproduction into a wall. */}
              <p className="mt-1 whitespace-pre-wrap text-base text-foreground">
                {report.description}
              </p>
            </section>

            {report.screenshots.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-card-foreground">
                  Screenshots
                </h3>
                <ul className="mt-2 grid grid-cols-2 gap-2">
                  {report.screenshots.map((shot) => (
                    <li key={shot.id}>
                      {/* Opens the signed inline URL in a new tab — the
                          browser's own image viewer beats a hand-built
                          lightbox, and it is the same call the quote-document
                          link makes. */}
                      <a
                        href={shot.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group block overflow-hidden rounded-md border border-border"
                      >
                        <img
                          src={shot.url}
                          alt={shot.filename}
                          loading="lazy"
                          className="aspect-video w-full bg-sunken object-cover transition-opacity group-hover:opacity-90"
                        />
                        <span className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
                          <ExternalLink className="size-3 shrink-0" />
                          <span className="truncate">{shot.filename}</span>
                          <span className="ml-auto shrink-0 tabular-nums">
                            {formatSize(shot.size)}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="text-sm font-semibold text-card-foreground">
                Captured context
              </h3>
              <dl className="mt-1">
                <ContextRow label="Page" value={report.context.route} />
                <ContextRow label="URL" value={report.context.url} />
                <ContextRow
                  label="Viewport"
                  value={
                    report.context.viewport
                      ? `${report.context.viewport.width} × ${report.context.viewport.height}`
                      : null
                  }
                />
                <ContextRow label="Theme" value={report.context.theme} />
                <ContextRow label="Browser" value={report.context.userAgent} />
                <ContextRow label="Reporter" value={report.reporterEmail} />
                <ContextRow
                  label="Agency"
                  value={report.agencyName ?? "Platform (no agency)"}
                />
              </dl>
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-sunken p-4">
              <div className="space-y-2">
                <Label htmlFor="bug-status">Status</Label>
                <Select
                  value={report.status}
                  onValueChange={(value) =>
                    save.mutate({ status: value as BugReportStatus })
                  }
                  disabled={save.isPending}
                >
                  <SelectTrigger id="bug-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUG_REPORT_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {BUG_REPORT_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {report.statusUpdatedAt && (
                  <p className="text-xs text-muted-foreground">
                    Last moved {relativeTime(report.statusUpdatedAt)}
                    {report.statusUpdatedByName
                      ? ` by ${report.statusUpdatedByName}`
                      : ""}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="bug-notes">Internal notes</Label>
                <Textarea
                  id="bug-notes"
                  rows={4}
                  maxLength={MAX_BUG_INTERNAL_NOTES_LENGTH}
                  placeholder="Never shown to the reporter."
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    setNotesDirty(true);
                  }}
                  disabled={save.isPending}
                />
                <Button
                  size="sm"
                  onClick={() => save.mutate({ internalNotes: notes })}
                  disabled={!notesChanged || save.isPending}
                >
                  {save.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Save notes
                </Button>
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
