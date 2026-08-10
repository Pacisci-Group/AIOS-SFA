import { Menu } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { SidebarBody, SidebarBrand } from "./SidebarBody";

/**
 * The phone/tablet nav: the same sidebar, in a left drawer.
 *
 * Rendered inside each page's own header rather than as a floating button —
 * every page has one, and a fixed hamburger would sit on top of page content at
 * exactly the width where there is least of it. Self-contained state, so a page
 * only has to drop `<MobileNav />` in; nothing has to be threaded through.
 *
 * `AppSidebar` is `hidden md:flex` and this is `md:hidden`, so exactly one nav
 * exists at any width.
 */
export function MobileNav({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open navigation"
          className={cn("shrink-0 text-muted-foreground md:hidden", className)}
        >
          <Menu />
        </Button>
      </SheetTrigger>

      <SheetContent
        ref={panelRef}
        side="left"
        // The default 75% of the viewport is wider than the nav needs and leaves
        // too little of the page showing behind it to keep your bearings.
        className="w-[264px] gap-0 border-sidebar-border bg-sidebar p-0 sm:max-w-none"
        onOpenAutoFocus={(event) => {
          // Radix moves focus to the first tabbable control, which here is the
          // theme switch in the footer — so Enter straight after opening the nav
          // flipped the theme instead of doing nothing. Focus the panel: the
          // dialog is still announced, and Tab walks the nav from the top.
          event.preventDefault();
          panelRef.current?.focus();
        }}
      >
        {/* Radix names the dialog from its `Title`; the visible wordmark is a
            logo rather than a heading, so the name is spelled out for screen
            readers instead of being inferred from the mark. */}
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Main navigation and account controls
        </SheetDescription>

        <div className="flex items-center gap-2 border-b border-sidebar-border px-3 py-3">
          <SidebarBrand />
        </div>

        {/* Closing on navigate is the whole reason `onNavigate` exists: React
            Router swaps the route in place, so without it the drawer would stay
            open over the page it just took you to. */}
        <SidebarBody onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
