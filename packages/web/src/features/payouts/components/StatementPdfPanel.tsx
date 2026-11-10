import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ExternalLink, FileText } from "lucide-react";
import { toast } from "sonner";
import { isEditableStatementStatus, type PayStatementView } from "@sfa/shared";
import { DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { openDocumentInNewTab } from "@/lib/open-document";
import {
  fetchPayStatementPreview,
  getPayStatementPdfLink,
  payStatementPdfKey,
  payStatementPreviewKey,
} from "@/lib/payouts-api";
import { payoutErrorMessage } from "../payout-errors";
import { formatInstantDay } from "../payout-format";

const FRAME =
  "h-[80vh] min-h-[480px] w-full rounded-lg border border-border bg-sunken";

/**
 * The Commission Statement PDF inside the statement page (PAC-181).
 *
 * An issued statement shows its stored file through a short-lived link the
 * API mints per read. The link is fetched once per visit and never kept:
 * the frame loads it once, and refetching would swap its `src` and reload
 * the document — or, from a cache, mount a link that has already expired.
 * A reviewer looking at a draft sees a preview rendered now. The PDF is
 * always the light layout; only the frame around it follows the theme.
 */
export function StatementPdfPanel({
  statement,
  reviewer,
}: {
  statement: PayStatementView;
  reviewer: boolean;
}) {
  const s = statement;
  return (
    <div className="space-y-6">
      {s.pdf ? (
        <IssuedPdf statement={s} />
      ) : reviewer && isEditableStatementStatus(s.status) ? (
        <DraftPreview statement={s} />
      ) : (
        <div className="rounded-xl border border-border bg-card px-5 py-16 text-center text-sm text-muted-foreground">
          This statement has not been issued yet.
        </div>
      )}
      {s.history.length > 0 && <EarlierVersions statement={s} />}
    </div>
  );
}

function IssuedPdf({ statement: s }: { statement: PayStatementView }) {
  // The version on screen, always: a statement reissued meanwhile must not
  // put the newer file under this version's heading.
  const link = useQuery({
    queryKey: payStatementPdfKey(s.id, s.version),
    queryFn: () => getPayStatementPdfLink(s.id, s.version),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  return (
    <DetailCard
      title="Commission statement PDF"
      icon={FileText}
      subheading={
        <p className="mt-1 text-xs text-muted-foreground">
          Version {s.version} · sent {formatInstantDay(s.sentAt, s.timeZone)}
          {s.sentBy?.name ? ` by ${s.sentBy.name}` : ""}
        </p>
      }
      action={
        <OpenButton
          resolve={() =>
            getPayStatementPdfLink(s.id, s.version).then((r) => r.url)
          }
        />
      }
    >
      {link.isError ? (
        <FrameError
          message={payoutErrorMessage(link.error)}
          onRetry={() => void link.refetch()}
        />
      ) : !link.data ? (
        <Skeleton className="h-[80vh] min-h-[480px] w-full rounded-lg" />
      ) : (
        <iframe
          title={`Commission statement PDF, version ${s.version}`}
          src={link.data.url}
          className={FRAME}
        />
      )}
    </DetailCard>
  );
}

function DraftPreview({ statement: s }: { statement: PayStatementView }) {
  const preview = useQuery({
    queryKey: payStatementPreviewKey(s.id, s.computedAt),
    queryFn: () => fetchPayStatementPreview(s.id),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!preview.data) return;
    const objectUrl = URL.createObjectURL(preview.data);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [preview.data]);

  // A disputed statement goes out as the next version (as the API's preview
  // and the send dialog say).
  const issuedAs = s.status === "rejected" ? s.version + 1 : s.version;
  return (
    <DetailCard
      title="Preview"
      icon={FileText}
      subheading={
        <p className="mt-1 text-xs text-muted-foreground">
          How version {issuedAs} will look when it is sent. It is not stored,
          and the employee cannot see it.
        </p>
      }
      action={
        url ? (
          // No `download`: on a same-origin blob URL it would save a file
          // instead of opening the tab the label promises.
          <Button size="sm" variant="outline" asChild>
            <a href={url} target="_blank" rel="noopener">
              <ExternalLink aria-hidden />
              Open in a new tab
            </a>
          </Button>
        ) : null
      }
    >
      {preview.isError ? (
        <FrameError
          message={payoutErrorMessage(preview.error)}
          onRetry={() => void preview.refetch()}
        />
      ) : !url ? (
        <Skeleton className="h-[80vh] min-h-[480px] w-full rounded-lg" />
      ) : (
        <iframe
          title={`Preview of the commission statement PDF, version ${issuedAs}`}
          src={url}
          className={FRAME}
        />
      )}
    </DetailCard>
  );
}

/** The versions issued before this one, each opened on a fresh link. */
function EarlierVersions({ statement: s }: { statement: PayStatementView }) {
  const rows = [...s.history].reverse();
  return (
    <DetailCard title="Earlier versions" bodyless>
      <ul className="divide-y divide-border">
        {rows.map((entry) => (
          <li
            key={entry.version}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          >
            <div className="min-w-0 text-sm">
              <span className="font-medium">Version {entry.version}</span>
              <span className="text-muted-foreground">
                {" "}
                · sent {formatInstantDay(entry.sentAt, s.timeZone)}
                {entry.sentBy?.name ? ` by ${entry.sentBy.name}` : ""} ·{" "}
                {entry.outcome === "reopened" ? "reopened" : "replaced"}{" "}
                {formatInstantDay(entry.at, s.timeZone)}
              </span>
            </div>
            {entry.pdf && (
              <OpenButton
                label="Open PDF"
                resolve={() =>
                  getPayStatementPdfLink(s.id, entry.version).then((r) => r.url)
                }
              />
            )}
          </li>
        ))}
      </ul>
    </DetailCard>
  );
}

function OpenButton({
  resolve,
  label = "Open in a new tab",
}: {
  resolve: () => Promise<string>;
  label?: string;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        void openDocumentInNewTab(resolve).catch((error: unknown) =>
          toast.error(payoutErrorMessage(error)),
        )
      }
    >
      <ExternalLink aria-hidden />
      {label}
    </Button>
  );
}

function FrameError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-sunken px-5 py-16 text-center">
      <AlertCircle aria-hidden className="size-5 text-destructive" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
