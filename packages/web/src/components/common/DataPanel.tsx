import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface DataPanelProps {
  title: string;
  subheading?: ReactNode;
  isPending: boolean;
  isError: boolean;
  /** `true` when the request succeeded and there is nothing to list. */
  isEmpty: boolean;
  emptyMessage: string;
  errorMessage: string;
  onRetry: () => void;
  /** Skeleton rows while loading — pinned so it cannot drift from the table. */
  skeletonRows: number;
  children: ReactNode;
  className?: string;
}

/**
 * A self-fetching table's shell: the app's `DetailCard`, plus the three states a
 * table has that a KPI card does not. Unlike a figure, a table *can* be empty —
 * "no producers sold or quoted in this period" is a sentence, not a row of
 * zeroes.
 *
 * Lived in `features/owner-dashboard/` as `OwnerPanel` until the Command Center
 * (PAC-138) needed the same three states. Promoted rather than imported
 * sideways: one feature reaching into another's components folder is how a
 * shared thing ends up owned by whichever feature happened to need it first.
 */
export function DataPanel({
  title,
  subheading,
  isPending,
  isError,
  isEmpty,
  emptyMessage,
  errorMessage,
  onRetry,
  skeletonRows,
  children,
  className,
}: DataPanelProps) {
  return (
    <DetailCard
      title={title}
      subheading={subheading}
      bodyless
      className={className}
    >
      {isError ? (
        <div className="flex flex-col items-center justify-center gap-3 px-5 py-10 text-center">
          <AlertCircle aria-hidden className="size-5 text-destructive" />
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : isPending ? (
        <div className="space-y-3 px-5 py-4">
          {Array.from({ length: skeletonRows }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : isEmpty ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        children
      )}
    </DetailCard>
  );
}
