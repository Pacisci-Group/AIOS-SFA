import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  type ShareLinkRow,
} from "@/lib/lead-intake-api";

interface ShareLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CopyUrlField({ link }: { link: ShareLinkRow }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access needs a secure context and can be blocked outright,
      // so tell the user rather than leaving the button looking broken.
      toast.error("Couldn't copy — select the link and copy it manually");
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={link.url}
        onFocus={(event) => event.currentTarget.select()}
        className="bg-background border-border text-xs font-mono"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void copy()}
        aria-label="Copy link"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
    </div>
  );
}

/**
 * Manage a producer's public intake links (PAC-37).
 *
 * A dialog rather than its own page: this is a utility a producer reaches for
 * occasionally from the Leads page, not a destination worth a route, a sidebar
 * entry and an empty state. Promoting it later is trivial.
 */
export function ShareLinkDialog({ open, onOpenChange }: ShareLinkDialogProps) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");

  const links = useQuery({
    queryKey: ["share-links"],
    queryFn: listShareLinks,
    enabled: open,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["share-links"] });

  const create = useMutation({
    mutationFn: () => createShareLink(label.trim() || undefined),
    onSuccess: () => {
      setLabel("");
      invalidate();
      toast.success("Share link created");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeShareLink(id),
    onSuccess: () => {
      invalidate();
      toast.success("Link revoked");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const items = links.data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share a lead form</DialogTitle>
          <DialogDescription>
            Anyone with the link can submit a lead, and it will be assigned to
            you. Revoking a link stops it working immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="share-link-label" className="text-xs text-muted-foreground">
            Label (optional)
          </Label>
          <div className="flex gap-2">
            <Input
              id="share-link-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Referrals from Dave at First National"
              maxLength={120}
              className="bg-card border-border"
            />
            <Button
              type="button"
              variant="brand"
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The label is just for you — it never reaches the lead.
          </p>
        </div>

        <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
          {links.isPending ? (
            <p className="text-sm text-muted-foreground">Loading links…</p>
          ) : links.isError ? (
            <p className="text-sm text-amber-500">Couldn't load your links.</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No share links yet. Create one above.
            </p>
          ) : (
            items.map((link) => (
              <div
                key={link.id}
                className={`rounded-lg border border-border p-3 space-y-2 ${
                  link.isActive ? "bg-card" : "bg-card/40 opacity-60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm truncate">
                      {link.label ?? "Untitled link"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {link.submissionCount}{" "}
                      {link.submissionCount === 1 ? "submission" : "submissions"}
                      {link.lastSubmissionAt
                        ? ` · last ${new Date(link.lastSubmissionAt).toLocaleDateString()}`
                        : ""}
                    </p>
                  </div>
                  {link.isActive ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={revoke.isPending}
                        >
                          Revoke
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke this link?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Anyone still holding it will no longer be able to
                            submit. Leads already received are unaffected. This
                            can't be undone — you'd need to create a new link.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => revoke.mutate(link.id)}
                          >
                            Revoke
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Revoked
                    </Badge>
                  )}
                </div>
                {link.isActive ? <CopyUrlField link={link} /> : null}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Trigger for {@link ShareLinkDialog}; gates itself on `leads:write`.
 *
 * Icon-only below `sm` (PAC-61). The Leads header now carries three actions
 * plus the mobile-nav hamburger, and three labelled buttons overflow a 375px
 * viewport — `AddLeadButton` already anticipated exactly this in its own
 * comment. `aria-label` is load-bearing rather than decorative: without it the
 * collapsed state is an unlabelled icon button.
 */
export function ShareLinkTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      aria-label="Share form"
    >
      <Link2 size={15} />
      <span className="hidden sm:inline">Share form</span>
    </Button>
  );
}
