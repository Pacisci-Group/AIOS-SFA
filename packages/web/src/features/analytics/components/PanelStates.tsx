import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A chart panel's body in its three non-data states — `DataPanel`'s, for a
 * panel whose header carries a toolbar `DataPanel` has no slot for.
 */
export function PanelBody({
  isPending,
  isError,
  isEmpty,
  emptyMessage,
  errorMessage,
  onRetry,
  children,
}: {
  isPending: boolean;
  isError: boolean;
  isEmpty: boolean;
  emptyMessage: string;
  errorMessage: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-5 py-10 text-center">
        <AlertCircle aria-hidden className="size-5 text-destructive" />
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (isPending) {
    return (
      <div className="space-y-3 px-5 py-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (isEmpty) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }
  return <>{children}</>;
}
