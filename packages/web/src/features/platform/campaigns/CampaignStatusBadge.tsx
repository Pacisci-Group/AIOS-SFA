import { Loader2 } from "lucide-react";
import type { MailerCampaignStatus } from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_STATUS_LABELS } from "./campaign-format";

/**
 * Which pill a lifecycle state gets.
 *
 * `previewed` is `default` (the brand fill) rather than a neutral grey: it is
 * the one state that is waiting on the operator, and on a list of thirty
 * campaigns it should be the thing the eye lands on. `superseded` is `outline`
 * — the record still exists and still owns its leads, so muting it away
 * entirely would misrepresent it as deleted.
 */
const VARIANT: Record<
  MailerCampaignStatus,
  "default" | "secondary" | "success" | "destructive" | "outline"
> = {
  uploaded: "secondary",
  previewed: "default",
  processing: "secondary",
  imported: "success",
  failed: "destructive",
  superseded: "outline",
};

/** The two states a worker job is still running in. */
const WORKING: MailerCampaignStatus[] = ["uploaded", "processing"];

export function CampaignStatusBadge({
  status,
  size = "sm",
}: {
  status: MailerCampaignStatus;
  size?: "sm" | "default";
}) {
  return (
    <Badge variant={VARIANT[status]} size={size}>
      {/* A spinner inside the pill, so "still working" reads without a second
          element competing for the same row. */}
      {WORKING.includes(status) && <Loader2 className="animate-spin" />}
      {CAMPAIGN_STATUS_LABELS[status]}
    </Badge>
  );
}
