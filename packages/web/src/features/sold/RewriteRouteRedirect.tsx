import { Navigate, useParams } from "react-router-dom";

/**
 * `/policies/:policyId/rewrite` → `/policies/:policyId`.
 *
 * The rewrite had a page of its own, then briefly a mode of the Sold form. It is
 * now a two-form chain that starts with a server lookup — resume the abandoned
 * lead, or create one — so there is no URL that can express "start a rewrite".
 * The policy page is where the button that *can* lives.
 *
 * Kept as a redirect rather than dropped because the old URL was linked from the
 * policy page and the household, so it is in browser history and in at least one
 * bookmark. `replace`, so Back returns to wherever the rep actually came from
 * rather than bouncing through this shim.
 */
export default function RewriteRouteRedirect() {
  const { policyId = "" } = useParams();
  return (
    <Navigate
      to={policyId ? `/policies/${encodeURIComponent(policyId)}` : "/clients"}
      replace
    />
  );
}
