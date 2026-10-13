import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** One error for a whole KPI row — the cards share one request. */
export function KpiRowError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-10 text-center">
      <AlertCircle aria-hidden className="size-5 text-destructive" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
