import { lazy, Suspense, useState } from "react";
import { Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";

/*
 * The dialog pulls in the picker, the upload client and a mutation — none of
 * which any page needs until someone actually clicks the button. Only the FAB
 * itself is in the main bundle.
 */
const ReportBugDialog = lazy(() =>
  import("./ReportBugDialog").then((module) => ({
    default: module.ReportBugDialog,
  })),
);

/**
 * The floating "Report a bug" button, mounted once for the whole app.
 *
 * ## Why it lives in `App.tsx` and not in `AppShell`
 *
 * `AppShell` is the *tenant* app's frame. The Super Admin panel renders
 * `SuperAdminLayout` instead, the public intake and invite pages render neither,
 * and several pages compose their own chrome. Mounting here — inside
 * `BrowserRouter`, outside `Routes` — is the only place that covers every
 * signed-in surface exactly once, and it is what lets the dialog read
 * `useLocation()` for the captured context.
 *
 * ## Who sees it
 *
 * Every authenticated user, with **no permission check**. That is the point: the
 * people most likely to hit a bug are the ones whose page just failed, and
 * gating the reporter on a module permission would silence exactly them. The
 * matching endpoint declares no permission either.
 *
 * Hidden when signed out — `/login`, the public lead form and the invite pages
 * have no session, and `POST /bug-reports` would 401.
 *
 * ## Position
 *
 * `bottom-6 right-6`, `z-40`. Below the `z-50` Radix dialog/popover layer so it
 * never floats over an open modal, and above page content. It claims the
 * bottom-right corner app-wide: the "Fast Log Mailer" button on
 * `/dashboard/management-alt` was moved up to `bottom-20` to yield to it.
 *
 * ## Colour
 *
 * An amber **tint**, not a solid fill. `variant="secondary"` left it at
 * `--secondary` — #F1F5F9 on a #F8FAFC page, near-invisible in the light theme,
 * which is the opposite of what a reporter needs to be.
 *
 * `--destructive` is the app's amber, and amber is the only hue with real
 * separation from this slate-and-blue chrome — so the hue does the spotting and
 * the fill can stay low: a 15% wash behind a 40% border and a solid icon,
 * deepening to 25% on hover. Loud enough to find from across the page, quiet
 * enough to sit in the corner of every screen all day. A solid `--primary` disc
 * would read as the page's own main CTA, and a solid `--destructive` one as an
 * error state; a tint reads as the persistent utility it is.
 *
 * The token rather than raw `amber-*` (per `packages/web/CLAUDE.md`) is what
 * makes this work in both themes with no `dark:` override — `--destructive`
 * is #B45309 on light and #F59E0B on dark, each already tuned for its
 * background, so the icon clears 4.5:1 either way. `cn` in `button.tsx` is
 * tailwind-merge, so these override the variant's `bg-`/`text-` and the base
 * `border-border` cleanly while keeping its focus ring.
 *
 * Note this borrows the *error* token for a non-error affordance. It is the
 * only amber in the palette; if a `--warning` or `--notice` token is ever added,
 * this should move to it.
 */
export function ReportBugWidget() {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  /**
   * Whether the dialog has ever been opened.
   *
   * The dialog is mounted on first open and then **kept** mounted, rather than
   * unmounted on close. Radix already unmounts `DialogContent` (and with it the
   * picker's document-level paste listener) whenever the dialog is closed, so
   * keeping the wrapper costs nothing — and tearing the whole subtree down on
   * close would cut the exit animation off mid-fade.
   */
  const [everOpened, setEverOpened] = useState(false);

  if (!isAuthenticated) return null;

  const openDialog = () => {
    setEverOpened(true);
    setOpen(true);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="secondary"
            aria-label="Report a bug"
            onClick={openDialog}
            className="fixed bottom-6 right-6 z-40 size-11 rounded-full border border-destructive/40 bg-destructive/15 text-destructive shadow-lg hover:bg-destructive/25"
          >
            <Bug className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Report a bug</TooltipContent>
      </Tooltip>

      {/*
        The chunk is fetched on first click, not at app boot. `null` fallback:
        the button has already acknowledged the click, and a spinner in the
        corner for a sub-second chunk load is noise.
      */}
      {everOpened && (
        <Suspense fallback={null}>
          <ReportBugDialog open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
