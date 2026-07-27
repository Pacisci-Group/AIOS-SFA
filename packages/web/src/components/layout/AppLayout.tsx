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
 */
export function AppLayout() {
  return (
    <div
      className="flex min-h-screen w-full"
      style={{ background: "var(--background)" }}
    >
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Outlet />
      </div>
    </div>
  );
}
