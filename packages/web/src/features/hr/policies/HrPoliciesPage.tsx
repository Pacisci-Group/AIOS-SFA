import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, MoreHorizontal, Plus, ScrollText, X } from "lucide-react";
import {
  HR_POLICY_TYPE_LABELS,
  HR_POLICY_TYPES,
  type HrPolicySummary,
  type HrPolicyType,
} from "@sfa/shared";
import { SettingsPage } from "@/features/settings/SettingsPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import {
  archiveHrPolicy,
  hrKeys,
  listHrPolicies,
} from "@/lib/hr-api";
import { cn } from "@/lib/utils";
import {
  POLICY_TYPE_META,
  POLICY_TYPE_ORDER,
  summarizePolicy,
  todayIso,
} from "./policy-display";
import { SuggestedPoliciesStrip } from "./time-off/SuggestedPoliciesStrip";

function isPolicyType(value: string | null): value is HrPolicyType {
  return (HR_POLICY_TYPES as readonly string[]).includes(value ?? "");
}

/**
 * Workspace Settings → HR policies (PAC-161 v3, PAC-174): every policy the agency has, one card per
 * type with its active count, and the suggested time off policies underneath. A card filters the list to its type (again to
 * clear), instantly and in the URL (`?type=holiday`) so the filter survives a
 * reload and a back from the wizard. Each card also creates its type.
 *
 * Replaces the v2 HR page — a workweek card over a whole-year calendar grid —
 * which David found far too much for "which days are we closed".
 */
export default function HrPoliciesPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("type");
  const filter = isPolicyType(raw) ? raw : null;
  const today = todayIso();

  // One read: the counts and the whole list. Filtering is client-side, so a
  // card click never waits on the network.
  const query = useQuery({
    queryKey: hrKeys.policies(null),
    queryFn: () => listHrPolicies(null),
  });

  const setFilter = (type: HrPolicyType | null) => {
    const next = new URLSearchParams(params);
    if (type) next.set("type", type);
    else next.delete("type");
    setParams(next, { replace: true });
  };

  const policies = (query.data?.policies ?? []).filter(
    (policy) => !filter || policy.type === filter,
  );

  return (
    <SettingsPage
      title="HR policies"
      caption="Holidays, work weeks and time off"
      icon={ScrollText}
      width="wide"
      action={<CreatePolicyMenu />}
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {POLICY_TYPE_ORDER.map((type) => (
            <PolicyTypeCard
              key={type}
              type={type}
              count={query.data?.counts[type]}
              selected={filter === type}
              onSelect={() => setFilter(filter === type ? null : type)}
            />
          ))}
        </div>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-card-foreground">
              {filter ? POLICY_TYPE_META[filter].label : "All policies"}
            </h2>
            {filter && (
              <Button variant="ghost" size="xs" onClick={() => setFilter(null)}>
                <X />
                Show all
              </Button>
            )}
          </div>

          {query.isPending ? (
            <div className="space-y-2 px-5 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : query.isError ? (
            <p className="px-5 py-6 text-sm text-destructive">
              Could not load the policies. Reload the page to try again.
            </p>
          ) : policies.length === 0 ? (
            <EmptyList filter={filter} />
          ) : (
            <PolicyTable policies={policies} today={today} />
          )}
        </section>

        {(!filter || filter === "time_off") && (
          <SuggestedPoliciesStrip policies={query.data?.policies ?? []} />
        )}
      </div>
    </SettingsPage>
  );
}

function CreatePolicyMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Plus />
          Create policy
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {POLICY_TYPE_ORDER.map((type) => {
          const meta = POLICY_TYPE_META[type];
          const Icon = meta.icon;
          return meta.createPath ? (
            <DropdownMenuItem key={type} asChild>
              <Link to={meta.createPath}>
                <Icon />
                <span className="capitalize">{meta.singular}</span>
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={type} disabled>
              <Icon />
              <span className="capitalize">{meta.singular}</span>
              <span className="ml-auto text-xs text-muted-foreground">Soon</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PolicyTypeCard({
  type,
  count,
  selected,
  onSelect,
}: {
  type: HrPolicyType;
  count: number | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = POLICY_TYPE_META[type];
  const Icon = meta.icon;
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-card transition-colors",
        selected ? "border-primary ring-2 ring-primary/30" : "border-border",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex flex-1 flex-col gap-3 rounded-t-xl px-5 pt-4 pb-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" />
          </span>
          <span className="text-sm font-semibold text-card-foreground">
            {meta.label}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums tracking-tight">
            {count ?? "…"}
          </span>
          <span className="text-sm text-muted-foreground">active</span>
        </div>
        <p className="text-sm text-muted-foreground">{meta.description}</p>
      </button>
      <div className="border-t border-border px-5 py-3">
        {meta.createPath ? (
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to={meta.createPath}>
              <Plus />
              Create {meta.singular}
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled>
            Coming soon
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyList({ filter }: { filter: HrPolicyType | null }) {
  const meta = filter ? POLICY_TYPE_META[filter] : null;
  return (
    <div className="space-y-1 px-5 py-10 text-center">
      <p className="text-base font-medium">
        {meta ? `No ${meta.label.toLowerCase()} yet.` : "No policies yet."}
      </p>
      <p className="text-sm text-muted-foreground">
        {meta && !meta.createPath
          ? "This kind of policy cannot be created yet."
          : "Create one from the cards above. A policy is a set of rules and the people it applies to."}
      </p>
    </div>
  );
}

function PolicyTable({
  policies,
  today,
}: {
  policies: HrPolicySummary[];
  today: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [archiving, setArchiving] = useState<HrPolicySummary | null>(null);
  const archive = useMutation({
    mutationFn: (id: string) => archiveHrPolicy(id),
    onSuccess: async () => {
      toast.success(`Archived ${archiving?.name ?? "the policy"}.`);
      setArchiving(null);
      await queryClient.invalidateQueries({ queryKey: hrKeys.all });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Could not archive the policy.",
      );
    },
  });

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Policy</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="hidden md:table-cell">Rules</TableHead>
            <TableHead className="text-right">People</TableHead>
            <TableHead className="w-12 pr-5" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {policies.map((policy) => (
            <TableRow
              key={policy.id}
              className="cursor-pointer"
              onClick={() => navigate(`/settings/hr-policies/${policy.id}`)}
            >
              <TableCell className="pl-5 font-medium">
                <Link
                  to={`/settings/hr-policies/${policy.id}`}
                  className="hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {policy.name}
                </Link>
                <p className="text-xs text-muted-foreground md:hidden">
                  {summarizePolicy(policy, today)}
                </p>
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {HR_POLICY_TYPE_LABELS[policy.type]}
                </Badge>
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                {summarizePolicy(policy, today)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {policy.memberCount}
              </TableCell>
              <TableCell className="pr-5" onClick={(event) => event.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${policy.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link to={`/settings/hr-policies/${policy.id}`}>Edit</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setArchiving(policy)}
                    >
                      Archive
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiving?.memberCount
                ? `The ${archiving.memberCount} ${archiving.memberCount === 1 ? "person" : "people"} in it will have no ${POLICY_TYPE_META[archiving.type].singular} until you add them to another one.`
                : "Nobody is in this policy."}{" "}
              The policy is kept on record but can no longer be edited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (archiving) archive.mutate(archiving.id);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
