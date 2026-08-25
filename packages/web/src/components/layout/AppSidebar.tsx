import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RailTooltip, SidebarBody, SidebarBrand } from "./SidebarBody";

/**
 * The desktop sidebar.
 *
 * **Hidden below `md`** — the phone equivalent is `MobileNav`, the same
 * `SidebarBody` in a left `Sheet`. `AppShell` mounts both, so a page never
 * decides for itself which nav it gets.
 *
 * Collapsing is just this element's own width: `AppShell` is a flex row, so a
 * narrower `<aside>` reflows the page beside it for free and nothing downstream
 * needs to know the control exists.
 */
export function AppSidebar() {
  const { collapsed, toggle } = useSidebarCollapsed();

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:flex",
        collapsed ? "w-[56px]" : "w-[224px]",
      )}
    >
      {/* Logo + collapse toggle. Stacks on the rail, which cannot hold the mark
          and the button side by side. */}
      <div
        className={cn(
          "flex border-b border-sidebar-border py-3",
          collapsed
            ? "flex-col items-center gap-2 px-2"
            : "flex-row items-center gap-2 px-3",
        )}
      >
        <SidebarBrand collapsed={collapsed} />
        <RailTooltip collapsed={collapsed} label="Expand sidebar (⌘B)">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="shrink-0 text-muted-foreground hover:text-sidebar-accent-foreground"
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </RailTooltip>
      </div>

      <SidebarBody collapsed={collapsed} />
    </aside>
  );
}
