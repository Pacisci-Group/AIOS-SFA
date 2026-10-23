import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Plus } from "lucide-react";
import { toast } from "sonner";
import type { LeavePolicySummary, LeavePolicyView } from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  archiveLeavePolicy,
  createLeavePolicy,
  getLeavePolicy,
  hrKeys,
  listLeavePolicies,
  updateLeavePolicy,
} from "@/lib/hr-api";
import { hrErrorMessage } from "../hr-error";
import { LeavePolicyEditor } from "./LeavePolicyEditor";
import { fromForm, newPolicyForm, toForm } from "./leave-policy-form";

interface PoliciesTabProps {
  canWrite: boolean;
  /** The wizard's wording differs: there, nothing exists yet and that is fine. */
  emptyMessage?: React.ReactNode;
}

type Editing = { kind: "new" } | { kind: "edit"; id: string } | null;

/**
 * The leave policies list and editor (PAC-161) — `/settings/hr` and the
 * onboarding HR Policy step both render this.
 *
 * An empty list is a legitimate state, not an error (Asad, 2026-10-22): the
 * agency does not use leave until someone adds a policy, and the copy says
 * what that means rather than nagging.
 */
export function PoliciesTab({ canWrite, emptyMessage }: PoliciesTabProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const list = useQuery({ queryKey: hrKeys.policies, queryFn: listLeavePolicies });
  const current = useQuery({
    queryKey: editing?.kind === "edit" ? hrKeys.policy(editing.id) : ["hr", "leave-policies", "none"],
    queryFn: () => getLeavePolicy((editing as { id: string }).id),
    enabled: editing?.kind === "edit",
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: hrKeys.policies });
    void queryClient.invalidateQueries({ queryKey: hrKeys.hrPolicy });
  };

  const save = useMutation({
    mutationFn: (input: ReturnType<typeof fromForm>) =>
      editing?.kind === "edit"
        ? updateLeavePolicy(editing.id, input)
        : createLeavePolicy(input),
    onSuccess: (policy: LeavePolicyView) => {
      queryClient.setQueryData(hrKeys.policy(policy.id), policy);
      refresh();
      setEditing(null);
      setServerError(null);
      toast.success(`"${policy.name}" saved.`);
    },
    onError: (error) => setServerError(hrErrorMessage(error)),
  });

  const archive = useMutation({
    mutationFn: (id: string) => archiveLeavePolicy(id),
    onSuccess: (policy) => {
      refresh();
      toast.success(`"${policy.name}" archived.`);
    },
    onError: (error) => toast.error(hrErrorMessage(error)),
  });

  if (list.isPending) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (list.isError) {
    return <p className="text-sm text-destructive">{hrErrorMessage(list.error)}</p>;
  }

  const policies = list.data.policies;
  const active = policies.filter((p) => p.status === "active");
  const archived = policies.filter((p) => p.status === "archived");

  if (editing?.kind === "new" || (editing?.kind === "edit" && current.data)) {
    const policy = editing.kind === "edit" ? current.data! : null;
    return (
      <LeavePolicyEditor
        key={policy ? `${policy.id}:${policy.version}` : "new"}
        initial={policy ? toForm(policy.name, policy.rules) : newPolicyForm()}
        saving={save.isPending}
        serverError={serverError}
        saveLabel={policy ? "Save changes" : "Create policy"}
        onSubmit={(values) => save.mutate(fromForm(values))}
        onCancel={() => {
          setEditing(null);
          setServerError(null);
        }}
      />
    );
  }
  if (editing?.kind === "edit") return <Skeleton className="h-96 w-full rounded-xl" />;

  const row = (policy: LeavePolicySummary) => (
    <li
      key={policy.id}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{policy.name}</p>
        <p className="text-xs text-muted-foreground">
          Version {policy.version} · {policy.employeeCount} employee
          {policy.employeeCount === 1 ? "" : "s"}
        </p>
      </div>
      {policy.status === "archived" ? (
        <Badge variant="outline">Archived</Badge>
      ) : (
        canWrite && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setServerError(null);
                setEditing({ kind: "edit", id: policy.id });
              }}
            >
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={policy.employeeCount > 0 || archive.isPending}
              title={
                policy.employeeCount > 0
                  ? `Move ${policy.employeeCount} employee${policy.employeeCount === 1 ? "" : "s"} to another policy first`
                  : undefined
              }
              onClick={() => archive.mutate(policy.id)}
            >
              <Archive className="size-4" />
              Archive
            </Button>
          </>
        )
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      {active.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
          {emptyMessage ?? (
            <>
              No leave policies yet. Until you add one, nobody can request time
              off and no employee onboarding is opened — the agency simply does
              not use that part of HR.
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-2">{active.map(row)}</ul>
      )}

      {canWrite && (
        <Button
          type="button"
          variant="brand"
          onClick={() => {
            setServerError(null);
            setEditing({ kind: "new" });
          }}
        >
          <Plus className="size-4" />
          New policy
        </Button>
      )}

      {archived.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground">Archived</h3>
          <ul className="space-y-2">{archived.map(row)}</ul>
        </section>
      )}
    </div>
  );
}
