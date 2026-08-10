import { Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

/** Route owning the New Lead form (PAC-37, story 2 of the Leads epic). */
export const NEW_LEAD_ROUTE = "/leads/new";

interface AddLeadButtonProps {
  /** Override the destination; defaults to {@link NEW_LEAD_ROUTE}. */
  to?: string;
  className?: string;
}

/**
 * The single "Add New Lead" entry point, shared by the Producer Dashboard header
 * (PAC-17) and the Leads page (PAC-36) so both stay in sync.
 *
 * Gates itself on `leads:write` and renders nothing without it — callers don't
 * need to wrap it in their own permission check.
 */
export function AddLeadButton({ to = NEW_LEAD_ROUTE, className }: AddLeadButtonProps) {
  const { canWrite } = usePermissions();
  if (!canWrite("leads")) return null;

  return (
    <Button
      asChild
      variant="brand"
      className={cn(
        "active:scale-95 shadow-[0_0_20px_rgba(56,189,248,0.25)]",
        className,
      )}
    >
      <Link to={to}>
        <Plus size={15} />
        {/* "Add New Lead" is 100px of label next to a Share button and a
            hamburger on a 375px header. The short form keeps the same verb and
            noun; the full one returns as soon as there is room. */}
        <span className="sm:hidden">New Lead</span>
        <span className="hidden sm:inline">Add New Lead</span>
      </Link>
    </Button>
  );
}
