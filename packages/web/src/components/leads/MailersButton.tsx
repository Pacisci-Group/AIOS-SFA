import { Mail } from "lucide-react";
import { useState } from "react";
import { MailerLookupDrawer } from "@/features/lead/components/MailerLookupDrawer";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { ModuleKey } from "@sfa/shared";

/**
 * "Mailers" entry point on the Leads page header (PAC-61).
 *
 * Mirrors `ShareLinkButton`: it gates itself on `mailers:read` and renders
 * nothing without it, so callers never wrap it in their own permission check.
 * A disabled `mailers` module removes the permission from the resolved set, so
 * the same check covers both.
 *
 * `variant="outline"`, like Share form — `AddLeadButton`'s `brand` gradient
 * stays the only primary action in the header.
 */
export function MailersButton() {
  const { canRead } = usePermissions();
  const [open, setOpen] = useState(false);

  if (!canRead(ModuleKey.Mailers)) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        // The label is hidden below `sm`, so the accessible name has to come
        // from here or the button is an unlabelled icon to a screen reader.
        aria-label="Look up a mailer"
      >
        <Mail className="size-4" />
        <span className="hidden sm:inline">Mailers</span>
      </Button>
      <MailerLookupDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}
