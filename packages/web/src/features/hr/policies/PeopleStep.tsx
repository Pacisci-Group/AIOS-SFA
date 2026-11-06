import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  TIME_OFF_TYPE_LABELS,
  type HrPolicyType,
  type PolicyPersonView,
  type PolicyRef,
  type TimeOffTypeKey,
} from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { hrKeys, listPolicyPeople } from "@/lib/hr-api";
import { NOT_AVAILABLE } from "@/lib/not-available";

/**
 * The last step of every policy wizard: who the policy applies to. Everyone
 * in the agency who has not been removed — invitees included, so a policy
 * can be ready before someone's first day.
 *
 * A person is in one policy of a type at most — per *kind* for time off
 * (PTO, Sick, …; a Custom policy moves nobody); ticking someone who is in
 * another says so on the row, and saving moves them.
 */
export function PeopleStep({
  type,
  timeOffType,
  policyId,
  value,
  onChange,
}: {
  type: HrPolicyType;
  /** With `type: "time_off"`: the kind the one-per-person rule is keyed on. */
  timeOffType?: TimeOffTypeKey;
  /** The policy being edited, so its own members are not "moving". */
  policyId: string | null;
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: hrKeys.people, queryFn: listPolicyPeople });
  const people = query.data?.people ?? [];
  const chosen = new Set(value);

  /** The person's current policy of this kind, if any. */
  const currentOf = (person: PolicyPersonView): PolicyRef | undefined => {
    if (type !== "time_off") return person.policies[type];
    if (!timeOffType || timeOffType === "custom") return undefined;
    return person.timeOffPolicies[timeOffType];
  };
  const kindLabel =
    type === "holiday"
      ? "holiday"
      : type === "work_week"
        ? "work week"
        : `${timeOffType ? TIME_OFF_TYPE_LABELS[timeOffType] : "time off"}`;

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((person) =>
      [person.name, person.email, person.branchName ?? ""].some((text) =>
        text.toLowerCase().includes(needle),
      ),
    );
  }, [people, search]);

  const allVisibleOn = visible.length > 0 && visible.every((p) => chosen.has(p.id));
  const moving = people.filter((person) => {
    const current = currentOf(person);
    return chosen.has(person.id) && current && current.id !== policyId;
  }).length;

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange([...next]);
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <h3 className="text-base font-semibold text-card-foreground">Employees</h3>
          <p className="text-sm text-muted-foreground">
            {value.length} selected
            {moving > 0 &&
              ` · ${moving} will move here from another ${kindLabel} policy`}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people"
            aria-label="Search people"
            className="pl-8"
          />
        </div>
      </div>

      {query.isPending ? (
        <div className="space-y-2 px-5 py-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : query.isError ? (
        <p className="px-5 py-4 text-sm text-destructive">Could not load the people.</p>
      ) : (
        <>
          <label className="flex cursor-pointer items-center gap-3 border-b border-border px-5 py-2.5 text-sm text-muted-foreground hover:bg-accent/40">
            <Checkbox
              checked={allVisibleOn}
              onCheckedChange={(on) => toggle(visible.map((p) => p.id), on === true)}
              aria-label="Select everyone shown"
            />
            {search ? `Select all ${visible.length} shown` : `Select everyone (${people.length})`}
          </label>
          <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto">
            {visible.map((person) => {
              const current = currentOf(person);
              const elsewhere = current && current.id !== policyId ? current : null;
              const id = `person-${person.id}`;
              return (
                <li key={person.id}>
                  <label
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-accent/40"
                  >
                    <Checkbox
                      id={id}
                      checked={chosen.has(person.id)}
                      onCheckedChange={(on) => toggle([person.id], on === true)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-base">
                        <span className="truncate">{person.name}</span>
                        {person.status === "invited" && (
                          <Badge variant="outline" size="sm">
                            Invited
                          </Badge>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {person.email}
                      </span>
                    </span>
                    <span className="hidden w-40 truncate text-sm text-muted-foreground sm:block">
                      {person.branchName ?? NOT_AVAILABLE}
                    </span>
                    <span className="w-48 truncate text-right text-xs text-muted-foreground">
                      {elsewhere
                        ? chosen.has(person.id)
                          ? `Moves from ${elsewhere.name}`
                          : `In ${elsewhere.name}`
                        : ""}
                    </span>
                  </label>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="px-5 py-4 text-sm text-muted-foreground">Nobody matches.</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
