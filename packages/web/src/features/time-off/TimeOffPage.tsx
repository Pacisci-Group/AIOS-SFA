import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Plane } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { TimeOffPolicyRef, TimeOffRequestView } from "@sfa/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { getTimeOffSummary, timeOffKeys } from "@/lib/time-off-api";
import { MyRequests } from "./my/MyRequests";
import { PolicyCards } from "./my/PolicyCards";
import { RequestSheet } from "./request/RequestSheet";
import { RequestViewSheet } from "./view/RequestViewSheet";

/** The request form, open for a new request on a policy or for a saved one. */
type FormState = { policy?: TimeOffPolicyRef; request?: TimeOffRequestView };

/**
 * Time off (PAC-165) — Gusto's page over our lifecycle.
 *
 * For an employee: a card per policy they are in (Available hours, Current
 * balance, **Request time off**) and their own requests underneath.
 *
 * A request opens in a drawer at `/time-off/requests/:requestId`, which is
 * also where a notification lands — so the link in an email opens the page
 * with that request on top, for the employee and the reviewer alike.
 */
export default function TimeOffPage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { search } = useLocation();
  const [form, setForm] = useState<FormState | null>(null);

  const summary = useQuery({
    queryKey: timeOffKeys.summary,
    queryFn: getTimeOffSummary,
  });

  const requestPath = (id: string) => `/time-off/requests/${id}${search}`;
  const closeRequest = () => navigate(`/time-off${search}`);

  return (
    <SettingsPage
      title="Time off"
      caption="Balances and requests"
      icon={Plane}
      width="wide"
      // A top-level page, not a settings section: the arrow goes home.
      backTo="/"
    >
      <div className="grid gap-8">
        <section className="grid gap-3">
          {summary.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Skeleton className="h-44 rounded-xl" />
              <Skeleton className="h-44 rounded-xl" />
            </div>
          ) : summary.isError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>Could not load your balances. Try again.</AlertDescription>
            </Alert>
          ) : (
            <PolicyCards
              policies={summary.data.policies}
              onRequest={(policy) => setForm({ policy })}
            />
          )}
        </section>

        <section className="grid gap-3">
          <h2 className="text-sm font-semibold text-foreground">My requests</h2>
          <MyRequests requestPath={requestPath} />
        </section>
      </div>

      {requestId && !form && (
        <RequestViewSheet
          key={requestId}
          requestId={requestId}
          onClose={closeRequest}
          onEdit={(request) => setForm({ request })}
        />
      )}
      {form && (
        <RequestSheet
          key={form.request?.id ?? form.policy?.id ?? "new"}
          mode="self"
          policy={form.policy}
          request={form.request}
          noReviewer={summary.data?.reviewerCount === 0}
          onClose={() => setForm(null)}
          // A request just saved or sent is shown as it now stands.
          onSaved={(saved) => navigate(requestPath(saved.id))}
        />
      )}
    </SettingsPage>
  );
}
