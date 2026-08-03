import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";

/**
 * Shared application shell. Renders the RBAC {@link AppSidebar} alongside the
 * routed page via `<Outlet />`, so every role sees a single, consistent left
 * navigation that only surfaces the pages they can read.
 *
 * Page bodies rendered into the outlet own their in-content header/filters and
 * their own theming; the shell only provides the sidebar + a flexible content
 * column. Route-level `RequirePermission` still gates each page (per-page
 * all-or-nothing model).
 *
 * The shell is pinned to the viewport (`h-screen` + `overflow-hidden`) rather
 * than allowed to grow (`min-h-screen`). Growing let the *document* scroll,
 * which dragged the whole page — sidebar and both workspace columns — as one.
 * Scrolling now belongs to the content column, or to a pane inside a page that
 * manages its own height.
 */
export function AppLayout() {
  return (
    <div
      className="flex h-screen w-full overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
