import type { LeadDetail } from "@sfa/shared";
import { CalendarDays, Pencil } from "lucide-react";
import { useState } from "react";
import { DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePermissions } from "@/hooks/usePermissions";
import { getStoredUser } from "@/lib/api-client";
import { agencyTodayYmd } from "@/lib/dates";
import { formatDate } from "./lead-display";

/**
 * When the lead came in, and — for anyone with `leads:write` — a control to
 * correct it (PAC-159).
 *
 * The business "lead received on" day, not when the record was typed in: a
 * lead entered a week late is counted, aged and attributed on this day by
 * every dashboard, so it has to be correctable, the way the sold and quote
 * dates are. The picker stops at the agency's today; the API also refuses a
 * day after the lead's first quote or sale, and the message lands here.
 */
export function LeadDateCard({
  lead,
  onChange,
  pending,
  error,
}: {
  lead: LeadDetail;
  onChange: (createdDate: string) => void;
  pending: boolean;
  /** The API's refusal, if any, shown under the input. */
  error: string | null;
}) {
  const { canWrite } = usePermissions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lead.createdDate ?? "");
  const today = agencyTodayYmd(getStoredUser()?.timeZone);
  const unchanged = draft === (lead.createdDate ?? "");

  return (
    <DetailCard
      title="Lead date"
      icon={CalendarDays}
      action={
        canWrite("leads") && !editing ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Edit lead date"
            onClick={() => {
              setDraft(lead.createdDate ?? "");
              setEditing(true);
            }}
          >
            <Pencil size={12} />
            Edit
          </Button>
        ) : undefined
      }
    >
      {editing ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft || unchanged) {
              setEditing(false);
              return;
            }
            onChange(draft);
            setEditing(false);
          }}
        >
          <label htmlFor="lead-date" className="sr-only">
            Lead date
          </label>
          <Input
            id="lead-date"
            type="date"
            max={today}
            value={draft}
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={Boolean(error)}
            className="sm:max-w-xs"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="brand"
              size="sm"
              disabled={pending || !draft || unchanged}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-base text-card-foreground">
          {formatDate(lead.createdDate)}
          <span className="ml-2 text-sm text-muted-foreground">
            {lead.agingDays === 1 ? "1 day ago" : `${lead.agingDays} days ago`}
          </span>
        </p>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </DetailCard>
  );
}
