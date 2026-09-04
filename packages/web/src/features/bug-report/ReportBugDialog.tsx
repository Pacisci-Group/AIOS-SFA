import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  BUG_SEVERITIES,
  BUG_SEVERITY_LABELS,
  MAX_BUG_DESCRIPTION_LENGTH,
  MIN_BUG_DESCRIPTION_LENGTH,
  type BugReportContext,
  type BugSeverity,
} from "@sfa/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { submitBugReport, type PendingScreenshot } from "@/lib/bug-reports-api";
import { ScreenshotPicker } from "./components/ScreenshotPicker";

interface ReportBugDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * What the browser knew when the report was filed.
 *
 * Collected rather than asked for: "which page were you on" is the first thing
 * triage needs and the last thing someone mid-bug will type. `theme` is in here
 * because a surprising share of defects in this app are light-theme-only — the
 * palette is token-driven and the five prototype dashboards are not at parity.
 *
 * Read at submit time, not at mount: a dialog left open while the user
 * navigates behind it would otherwise report the page they started on.
 */
function captureContext(pathname: string): BugReportContext {
  return {
    url: window.location.href,
    route: pathname,
    userAgent: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    theme: document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  };
}

/**
 * The "Report a bug" form.
 *
 * Deliberately hand-bound rather than built on `useAppForm`: it is two fields
 * and a picker with no cross-field rules, no field-path renaming risk and no
 * shared fragments — the machinery in `hooks/form.ts` exists for the Sold
 * wizard's conditional cards, and wiring a textarea through it here would add
 * indirection without buying a single guarantee. The convention in AGENTS.md
 * §11 is about the intake forms; this is a support widget.
 */
export function ReportBugDialog({ open, onOpenChange }: ReportBugDialogProps) {
  const location = useLocation();
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BugSeverity>("normal");
  const [screenshots, setScreenshots] = useState<PendingScreenshot[]>([]);

  /*
   * Reset on close, and revoke every object URL as we go — the picker only
   * revokes the ones the user removes by hand, so cancelling with three
   * thumbnails on screen would leak all three.
   */
  useEffect(() => {
    if (open) return;
    for (const shot of screenshots) URL.revokeObjectURL(shot.previewUrl);
    setDescription("");
    setSeverity("normal");
    setScreenshots([]);
    // Keyed on `open` alone. `screenshots` is deliberately not a dependency —
    // including it would re-run this on every add and remove while the dialog
    // is open, wiping the form as the user fills it in. The early return means
    // it only ever fires on the open -> closed edge, where the closure holds
    // exactly the screenshots that were on screen.
  }, [open]);

  const submit = useMutation({
    mutationFn: () =>
      submitBugReport({
        description,
        severity,
        screenshots,
        context: captureContext(location.pathname),
      }),
    onSuccess: () => {
      toast.success("Thanks — your bug report was sent.");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const trimmed = description.trim();
  const tooShort = trimmed.length < MIN_BUG_DESCRIPTION_LENGTH;
  const canSubmit = !tooShort && !submit.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>
            Tell us what went wrong. We capture the page you're on
            automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bug-description">What happened?</Label>
            <Textarea
              id="bug-description"
              autoFocus
              rows={5}
              maxLength={MAX_BUG_DESCRIPTION_LENGTH}
              placeholder="What were you doing, what did you expect, and what happened instead?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={submit.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bug-severity">How much is it blocking you?</Label>
            <Select
              value={severity}
              onValueChange={(value) => setSeverity(value as BugSeverity)}
              disabled={submit.isPending}
            >
              <SelectTrigger id="bug-severity" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUG_SEVERITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {BUG_SEVERITY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Screenshots</Label>
            <ScreenshotPicker
              screenshots={screenshots}
              onChange={setScreenshots}
              disabled={submit.isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submit.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => submit.mutate()} disabled={!canSubmit}>
            {submit.isPending && <Loader2 className="size-4 animate-spin" />}
            {submit.isPending ? "Sending…" : "Send report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
