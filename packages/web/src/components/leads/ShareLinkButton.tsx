import { useState } from "react";
import { ShareLinkDialog, ShareLinkTrigger } from "@/features/lead/components/ShareLinkDialog";
import { usePermissions } from "@/hooks/usePermissions";

/**
 * "Share form" entry point for a producer's public intake links (PAC-37).
 *
 * Mirrors `AddLeadButton`: it gates itself on `leads:write` and renders nothing
 * without it, so callers never wrap it in their own permission check.
 */
export function ShareLinkButton() {
  const { canWrite } = usePermissions();
  const [open, setOpen] = useState(false);

  if (!canWrite("leads")) return null;

  return (
    <>
      <ShareLinkTrigger onClick={() => setOpen(true)} />
      <ShareLinkDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
