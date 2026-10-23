import { ModuleKey } from "@sfa/shared";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DrawerRow,
  DrawerSection,
} from "@/features/clients/components/drawer-primitives";
import {
  formatDate,
  statusBadgeClass,
} from "@/features/lead/components/lead-display";
import { usePermissions } from "@/hooks/usePermissions";
import type { DealAuditReviewLead } from "@/lib/deal-audits-api";
import { cn } from "@/lib/utils";

/**
 * "View lead" on the Deal Audit page (PAC-106): who the client was when they
 * came in, without leaving the audit.
 *
 * Rendered from the page's payload — no request of its own. **Open lead**
 * links to the full Lead Detail page only for someone who can read leads; a
 * Branch Manager can, but the button is gated rather than assumed.
 */
export function LeadDrawer({
  lead,
  open,
  onClose,
}: {
  lead: DealAuditReviewLead | null;
  open: boolean;
  onClose: () => void;
}) {
  const { canRead } = usePermissions();

  return (
    <Sheet open={open && !!lead} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:w-[440px] sm:max-w-[440px]"
      >
        {lead && (
          <>
            <SheetHeader className="gap-1 border-b border-border px-6 py-5">
              <SheetDescription>Lead</SheetDescription>
              <SheetTitle>{lead.name}</SheetTitle>
              {lead.status && (
                <Badge
                  size="sm"
                  className={cn("mt-1 border-transparent", statusBadgeClass(lead.status))}
                >
                  {lead.status}
                </Badge>
              )}
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
              <div>
                <DrawerRow label="Lead date" value={formatDate(lead.createdDate)} />
                <DrawerRow label="Lead source" value={lead.leadSourceName} />
                <DrawerRow label="Temperature" value={lead.temperature} />
                <DrawerRow label="Producer" value={lead.producerName} />
              </div>
              <DrawerSection title="Contact">
                <DrawerRow label="Phone" value={lead.phone} />
                <DrawerRow label="Email" value={lead.email} />
              </DrawerSection>
            </div>

            {canRead(ModuleKey.Leads) && (
              <div className="border-t border-border px-6 py-4">
                <Button asChild variant="outline" className="w-full">
                  <Link to={`/leads/${lead.id}`}>Open lead</Link>
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
