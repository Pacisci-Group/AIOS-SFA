import { useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import {
  ACCRUAL_TYPE_LABELS,
  COMPENSATION_LABELS,
  TIME_OFF_TYPE_LABELS,
  type TimeOffPolicyRules,
} from "@sfa/shared";
import { Pencil } from "lucide-react";
import { DetailCard } from "@/components/common/DetailCard";
import { FormGrid } from "@/components/form";
import { Button } from "@/components/ui/button";
import { withForm } from "@/hooks/form";
import { hrKeys, listPolicyPeople } from "@/lib/hr-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { accrualLabel, formatBalance, noticeLabel, resetLabel } from "../time-off-display";
import { EMPTY_TIME_OFF, toRules, toStartingBalances, type TimeOffSection } from "../time-off-form";

/**
 * Step 5 — Gusto's review: one section per step with Edit in place, the
 * auto-approval rules editable right here (where Gusto keeps them), then
 * Activate. The activated policy page renders the same sections read-only
 * through {@link ReviewSections}, with Edit opening a drawer instead.
 */
export const ReviewStep = withForm({
  defaultValues: EMPTY_TIME_OFF,
  props: { onEdit: (_section: TimeOffSection) => {} },
  render: function Render({ form, onEdit }) {
    const values = useStore(form.store, (s) => s.values);
    const rules = toRules(values);
    const balances = toStartingBalances(values) ?? {};
    return (
      <div className="space-y-4">
        <ReviewSections
          name={values.name}
          rules={rules}
          memberIds={values.memberIds}
          balances={balances}
          onEdit={onEdit}
          autoApprove={
            <DetailCard title="Auto-approve requests">
              <AutoApproveFields form={form} />
            </DetailCard>
          }
        />
      </div>
    );
  },
});

/** The two rules; also the body of the activated page's auto-approve drawer. */
export const AutoApproveFields = withForm({
  defaultValues: EMPTY_TIME_OFF,
  render: function Render({ form }) {
    return (
      <form.AppField name="autoApproveEnabled">
        {(f) => (
          <f.SwitchField
            label="Approve requests automatically"
            hint="A request that meets every rule below is approved the moment it is submitted. Anything else goes to a person. Time a manager records on someone's behalf is never auto-approved, and a request that would take the balance below zero needs a person unless negative balances are on."
          >
            <FormGrid columns={2} gap={3} className="max-w-xl">
              <form.AppField name="autoApproveMaxCalendarDays">
                {(d) => (
                  <d.NumberField
                    label="Maximum calendar days per request"
                    description="First day through last, weekends included. Blank for no limit."
                    inputMode="numeric"
                    step="1"
                    min="1"
                  />
                )}
              </form.AppField>
              <form.AppField name="autoApproveMinNoticeDays">
                {(d) => (
                  <d.NumberField
                    label="Minimum notice (days)"
                    description="Days between submitting and the first day off. Blank for none."
                    step="0.5"
                    min="0"
                  />
                )}
              </form.AppField>
            </FormGrid>
          </f.SwitchField>
        )}
      </form.AppField>
    );
  },
});

/**
 * The five summary sections. `onEdit` opens the step (wizard) or the drawer
 * (policy page); `autoApprove` replaces the read-only fifth section with the
 * live fields in the wizard. `members` carries live balances on the policy
 * page; the wizard shows the balances about to be posted.
 */
export function ReviewSections({
  name,
  rules,
  memberIds,
  balances,
  members,
  onEdit,
  autoApprove,
}: {
  name: string;
  rules: TimeOffPolicyRules;
  memberIds: readonly string[];
  /** Wizard: what will be posted (blank = default). */
  balances?: Record<string, number>;
  /** Policy page: the live members with their balances. */
  members?: readonly { id: string; name: string; email: string; balanceHours?: number | null }[];
  onEdit: (section: TimeOffSection) => void;
  autoApprove?: React.ReactNode;
}) {
  const people = useQuery({
    queryKey: hrKeys.people,
    queryFn: listPolicyPeople,
    enabled: !members,
  });
  const unlimited = rules.accrualType === "unlimited";
  // Outlined, with the pencil: a bare ghost "Edit" was missed at the demo —
  // it only looks like a control once the pointer is already on it.
  const editButton = (section: TimeOffSection, what: string) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Edit ${what}`}
      onClick={() => onEdit(section)}
    >
      <Pencil />
      Edit
    </Button>
  );
  const nameOf = (id: string) =>
    members?.find((m) => m.id === id)?.name ??
    people.data?.people.find((p) => p.id === id)?.name ??
    NOT_AVAILABLE;

  return (
    <>
      <DetailCard title="Basic setup" action={editButton("basics", "basic setup")}>
        <dl className="space-y-2 text-sm">
          <Row label="Name" value={name} />
          <Row label="Kind" value={TIME_OFF_TYPE_LABELS[rules.timeOffType]} />
          <Row label="Description" value={rules.description ?? "None"} muted={!rules.description} />
          <Row label="Compensation" value={COMPENSATION_LABELS[rules.compensation]} />
          <Row label="Accrual type" value={ACCRUAL_TYPE_LABELS[rules.accrualType]} />
        </dl>
      </DetailCard>

      <DetailCard title="Settings" action={editButton("settings", "settings")}>
        <dl className="space-y-2 text-sm">
          <Row
            label="Waiting period"
            value={rules.waitingPeriodDays !== null ? `${rules.waitingPeriodDays} days after hire` : "None"}
            muted={rules.waitingPeriodDays === null}
          />
          <Row label="Negative balances" value={rules.allowNegativeBalance ? "Allowed" : "Not allowed"} />
          {!unlimited && rules.compensation === "paid" && (
            <Row label="Unused time off payout" value={rules.payOutOnTermination ? "On" : "Off"} />
          )}
        </dl>
      </DetailCard>

      {!unlimited && (
        <DetailCard title="Accrual" action={editButton("accrual", "accrual")}>
          <dl className="space-y-2 text-sm">
            <Row label="Hours per year" value={formatBalance(rules.hoursPerYear)} />
            <Row label="Earned" value={accrualLabel(rules)} />
            <Row label="Reset" value={resetLabel(rules)} />
            <Row label="Max balance" value={rules.maxBalanceHours !== null ? formatBalance(rules.maxBalanceHours) : "No cap"} muted={rules.maxBalanceHours === null} />
            {!(rules.resetDateKind === "hire_anniversary" && rules.accrualFrequency === "yearly") && (
              <Row
                label="Carryover cap"
                value={
                  rules.carryoverCapHours === null
                    ? "Everything carries over"
                    : rules.carryoverCapHours === 0
                      ? "Nothing carries over"
                      : formatBalance(rules.carryoverCapHours)
                }
              />
            )}
            {rules.timeOffType === "sick" && (
              <Row
                label="Annual usage cap"
                value={rules.annualUsageCapHours !== null ? formatBalance(rules.annualUsageCapHours) : "No cap"}
                muted={rules.annualUsageCapHours === null}
              />
            )}
          </dl>
        </DetailCard>
      )}

      <DetailCard title="Enrollment" action={editButton("enrollment", "enrollment")}>
        {memberIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody yet. People can be added any time.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {memberIds.map((id) => {
              const live = members?.find((m) => m.id === id);
              const hours = live ? live.balanceHours : (balances?.[id] ?? null);
              return (
                <li key={id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate">{nameOf(id)}</span>
                  {!unlimited && (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {live
                        ? formatBalance(hours)
                        : hours !== null && hours !== undefined
                          ? `starts with ${formatBalance(hours)}`
                          : "default balance"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DetailCard>

      {autoApprove ?? (
        <DetailCard title="Auto-approve requests" action={editButton("autoApprove", "auto-approve requests")}>
          <dl className="space-y-2 text-sm">
            <Row label="Auto-approval" value={rules.autoApprove.enabled ? "On" : "Off"} />
            {rules.autoApprove.enabled && (
              <>
                <Row
                  label="Max calendar days per request"
                  value={rules.autoApprove.maxCalendarDays !== null ? String(rules.autoApprove.maxCalendarDays) : "No limit"}
                  muted={rules.autoApprove.maxCalendarDays === null}
                />
                <Row label="Minimum notice" value={noticeLabel(rules.autoApprove.minNoticeHours)} />
              </>
            )}
          </dl>
        </DetailCard>
      )}
    </>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={muted ? "text-muted-foreground" : "text-foreground"}>{value}</dd>
    </div>
  );
}
