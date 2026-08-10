import type { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";

/**
 * The signed-in app frame: nav on the left, page to the right of it.
 *
 * Replaces the `flex min-h-screen` + `hidden md:block` + `flex-1 min-w-0`
 * stanza that every page had pasted into it — which is how one page ended up
 * with `overflow-x-hidden`, another with none, and the mobile-nav gap ended up
 * being every page's problem to solve separately.
 *
 * `min-w-0` on the content column is load-bearing, not decoration: a flex item
 * defaults to `min-width: auto`, so without it any wide child (a table, a long
 * unbroken policy number) pushes the column past the viewport instead of
 * scrolling or truncating inside it.
 *
 * Pages render their own header and put `<MobileNav />` in it — there is no
 * second app bar, because stacking one above every page header would cost a
 * row of vertical space on exactly the screens that have the least.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
