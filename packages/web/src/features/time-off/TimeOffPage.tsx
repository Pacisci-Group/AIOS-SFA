import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Plane, Plus } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AgencyPermission,
  ModuleKey,
  type TimeOffPolicyRef,
  type TimeOffRequestView,
} from "@sfa/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { usePermissions } from "@/hooks/usePermissions";
import { getTimeOffSummary, listRecordablePeople, timeOffKeys } from "@/lib/time-off-api";
import { MyRequests } from "./my/MyRequests";
import { PolicyCards } from "./my/PolicyCards";
import { RequestSheet } from "./request/RequestSheet";
import { TeamRequests } from "./team/TeamRequests";
import { RequestViewSheet } from "./view/RequestViewSheet";

/** The request form: a new request on a policy, a saved one, or a record for someone else. */
type FormState =
  | { mode: "self"; policy?: TimeOffPolicyRef; request?: TimeOffRequestView }
  | { mode: "record" };

type Tab = "mine" | "team";

/**
 * Time off (PAC-165) — Gusto's page over our lifecycle.
 *
 * **My time off**, for every employee: a card per policy they are in
 * (Available hours, Current balance, **Request time off**) and their own
 * requests underneath.
 *
 * **Team**, for a reviewer (`hr:write`): the requests of the people in
 * their data scope, opening on To review. With `agency:users:read` as well
 * they can **Record time off** for someone — created already approved.
 *
 * A request opens in a drawer at `/time-off/requests/:requestId`, which is
 * also where a notification lands — the link in an email opens the page
 * with that request on top, for the employee and the reviewer alike. The
 * tab and the profile's `?employee=` filter live in the query string, so
 * they survive opening and closing a request.
 */
export default function TimeOffPage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can, canWrite } = usePermissions();
  const [form, setForm] = useState<FormState | null>(null);

  const reviewer = canWrite(ModuleKey.Hr);
  const canRecord = reviewer && can(AgencyPermission.UsersRead);
  const tab: Tab = reviewer && searchParams.get("tab") === "team" ? "team" : "mine";
  const employeeId = reviewer ? (searchParams.get("employee") ?? undefined) : undefined;

  const summary = useQuery({
    queryKey: timeOffKeys.summary,
    queryFn: getTimeOffSummary,
  });
  const people = useQuery({
    queryKey: timeOffKeys.recordablePeople,
    queryFn: listRecordablePeople,
    enabled: canRecord && form?.mode === "record",
  });

  const search = searchParams.toString();
  const suffix = search ? `?${search}` : "";
  const requestPath = (id: string) => `/time-off/requests/${id}${suffix}`;
  const closeRequest = () => navigate(`/time-off${suffix}`);
  const setParams = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    change(next);
    setSearchParams(next, { replace: true });
  };

  const mine = (
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
            onRequest={(policy) => setForm({ mode: "self", policy })}
          />
        )}
      </section>
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold text-foreground">My requests</h2>
        <MyRequests requestPath={requestPath} />
      </section>
    </div>
  );

  return (
    <SettingsPage
      title="Time off"
      caption={reviewer ? "Balances, requests and reviews" : "Balances and requests"}
      icon={Plane}
      width="wide"
      // A top-level page, not a settings section: the arrow goes home.
      backTo="/"
      action={
        canRecord ? (
          <Button variant="outline" size="sm" onClick={() => setForm({ mode: "record" })}>
            <Plus className="size-4" />
            Record time off
          </Button>
        ) : undefined
      }
    >
      {reviewer ? (
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setParams((next) => {
              if (value === "team") next.set("tab", "team");
              else {
                next.delete("tab");
                next.delete("employee");
              }
            })
          }
        >
          <TabsList className="mb-5">
            <TabsTrigger value="mine">My time off</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>
          <TabsContent value="mine">{mine}</TabsContent>
          <TabsContent value="team">
            <TeamRequests
              // A different person is a different list: start its filters over.
              key={employeeId ?? "everyone"}
              employeeId={employeeId}
              onClearEmployee={() => setParams((next) => next.delete("employee"))}
              requestPath={requestPath}
            />
          </TabsContent>
        </Tabs>
      ) : (
        mine
      )}

      {requestId && !form && (
        <RequestViewSheet
          key={requestId}
          requestId={requestId}
          onClose={closeRequest}
          onEdit={(request) => setForm({ mode: "self", request })}
        />
      )}
      {form?.mode === "self" && (
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
      {form?.mode === "record" && (
        <RequestSheet
          key="record"
          mode="record"
          people={people.data ?? []}
          onClose={() => setForm(null)}
          onSaved={(saved) => navigate(requestPath(saved.id))}
        />
      )}
    </SettingsPage>
  );
}
