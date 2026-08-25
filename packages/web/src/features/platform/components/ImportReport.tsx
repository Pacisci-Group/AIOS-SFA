import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MailerImportRun } from "@/lib/platform-mailers-api";

interface Props {
  run: MailerImportRun;
  /** The agency the operator picked, for the mismatch warning's copy. */
  agencyName?: string;
  working: boolean;
  committing: boolean;
  onCommit: (confirmAgencyMismatch: boolean) => void;
  onReset: () => void;
}

/**
 * What the file contains, and — after a commit — what was written (PAC-73).
 *
 * One component for both phases because they report the same shape; the only
 * difference is whether the numbers are a projection or a result. Splitting
 * them would let the preview drift from the outcome it is supposed to predict.
 */
export function ImportReport({
  run,
  agencyName,
  working,
  committing,
  onCommit,
  onReset,
}: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const counts = run.counts;
  const detected = run.detected;
  const canCommit = run.status === "previewed";
  const done = run.status === "completed";

  return (
    <div className="flex flex-col gap-4">
      {working && (
        <Alert>
          <Loader2 className="size-4 animate-spin" />
          <AlertTitle>
            {run.status === "previewing"
              ? "Reading the file…"
              : "Importing mailers…"}
          </AlertTitle>
          <AlertDescription>
            {run.status === "previewing"
              ? "Nothing has been written yet."
              : "This keeps running if you close the tab."}
          </AlertDescription>
        </Alert>
      )}

      {run.status === "failed" && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>The import failed</AlertTitle>
          <AlertDescription>
            {run.error ?? "No further detail was recorded."}
          </AlertDescription>
        </Alert>
      )}

      {done && (
        <Alert>
          <CheckCircle2 className="size-4 text-success" />
          <AlertTitle>Import complete</AlertTitle>
          <AlertDescription>
            Producers can now look these mailers up by either control-number
            form.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-card-foreground">
              {run.uploadedFilename}
            </h3>
            <Badge size="sm" variant="secondary">
              {run.status}
            </Badge>
          </div>

          {detected && (
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Detail label="Agency in file">
                {detected.agencyName ?? "—"}
                {detected.agencyId ? ` (${detected.agencyId})` : ""}
              </Detail>
              <Detail label="Campaign">
                {detected.campaignNumber ?? "—"}
                {detected.weekNumber ? ` · week ${detected.weekNumber}` : ""}
              </Detail>
              <Detail label="Quote date">
                {detected.quoteDate?.slice(0, 10) ?? "—"}
              </Detail>
              <Detail label="Product">
                {[detected.policyType, detected.product]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </Detail>
              <Detail label="Quote file">{detected.fileName ?? "—"}</Detail>
              <Detail label="Size">{formatBytes(run.sizeBytes)}</Detail>
            </dl>
          )}

          {counts && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Rows read" value={counts.read} />
              {/*
                Before a commit these are both zero and would read as "nothing
                will happen", so the projection shows what *will* be attempted
                instead.
              */}
              {done ? (
                <>
                  <Stat label="Created" value={counts.created} />
                  <Stat label="Updated" value={counts.updated} />
                </>
              ) : (
                <Stat label="Will import" value={counts.mapped} />
              )}
              <Stat label="Skipped" value={counts.skipped} />
            </div>
          )}
        </CardContent>
      </Card>

      {run.agencyMismatch && canCommit && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>This file is for a different agency</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>
              The file reports{" "}
              <strong>{detected?.agencyName ?? detected?.agencyId}</strong>, but
              you selected <strong>{agencyName ?? "another agency"}</strong>.
              Importing anyway files one agency's prospects under another.
            </span>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
              />
              Import it anyway
            </label>
          </AlertDescription>
        </Alert>
      )}

      {run.rejections.length > 0 && (
        <Card>
          <CardContent className="px-5 py-4">
            <h3 className="mb-3 text-sm font-semibold text-card-foreground">
              Skipped rows
            </h3>
            {/* A sample, not the list — `counts.skipped` is the real total. */}
            <p className="mb-3 text-sm text-muted-foreground">
              Showing {run.rejections.length} of{" "}
              {(counts?.skipped ?? 0).toLocaleString()}.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Row</TableHead>
                    <TableHead>Control number</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.rejections.map((rejection, index) => (
                    <TableRow key={`${rejection.row}-${index}`}>
                      <TableCell className="tabular-nums">
                        {rejection.row > 0 ? rejection.row : "—"}
                      </TableCell>
                      <TableCell>{rejection.controlNumber ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {rejection.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canCommit && (
          <Button
            disabled={committing || (run.agencyMismatch && !confirmed)}
            onClick={() => onCommit(run.agencyMismatch && confirmed)}
          >
            {committing && <Loader2 className="size-4 animate-spin" />}
            Import {(counts?.mapped ?? 0).toLocaleString()}{" "}
            {counts?.mapped === 1 ? "mailer" : "mailers"}
          </Button>
        )}
        <Button variant="outline" onClick={onReset} disabled={committing}>
          {done || run.status === "failed" ? "Upload another" : "Cancel"}
        </Button>
        {run.rawFileUrl && (
          <Button asChild variant="ghost" size="sm" className="gap-1">
            {/*
              The raw file is kept in storage deliberately — it is the only way
              to re-import after a mapping bug.
            */}
            <a href={run.rawFileUrl} rel="noreferrer">
              <Download className="size-4" />
              Original file
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A real RTP file is ~23 MB, but a trimmed test slice is a few KB — and fixed
 * MB always rendered those as "0.0 MB", which reads as a failed upload rather
 * than a small file.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-sunken px-3 py-2">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="text-base tabular-nums text-foreground">
        {value.toLocaleString()}
      </p>
    </div>
  );
}
