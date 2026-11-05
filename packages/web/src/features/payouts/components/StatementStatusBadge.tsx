import type { PayStatementStatus } from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  STATEMENT_STATUS_CLASSES,
  STATEMENT_STATUS_LABELS,
} from "../payout-format";

/** A statement's status, with its version once it has been re-sent. */
export function StatementStatusBadge({
  status,
  version,
  className,
}: {
  status: PayStatementStatus;
  version?: number;
  className?: string;
}) {
  return (
    <Badge
      size="sm"
      variant="ghost"
      className={cn("shrink-0", STATEMENT_STATUS_CLASSES[status], className)}
    >
      {STATEMENT_STATUS_LABELS[status]}
      {version && version > 1 ? ` · v${version}` : null}
    </Badge>
  );
}
