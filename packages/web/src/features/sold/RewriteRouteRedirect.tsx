import { Navigate, useParams } from "react-router-dom";

/**
 * `/policies/:policyId/rewrite` → `/sold/new?rewritePolicyId={id}`.
 *
 * The rewrite had a page and a route of its own until PAC-126 folded it into the
 * Sold form, which is the page every other policy write already went through.
 * This keeps the old URL working: it was linked from the policy detail page and
 * from the household, so it will be in browser history and in at least one
 * bookmark.
 *
 * `replace` so the back button returns to wherever the rep actually came from
 * rather than bouncing through this shim.
 */
export default function RewriteRouteRedirect() {
  const { policyId = "" } = useParams();
  return (
    <Navigate
      to={`/sold/new?rewritePolicyId=${encodeURIComponent(policyId)}`}
      replace
    />
  );
}
