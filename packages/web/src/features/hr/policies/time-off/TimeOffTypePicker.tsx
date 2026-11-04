import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { TIME_OFF_TYPE_KEYS, TIME_OFF_TYPE_META } from "@sfa/shared";
import { POLICY_TYPE_META } from "../policy-display";
import { PolicyWizardShell } from "../PolicyWizardShell";

/**
 * The first screen of the time off wizard (PAC-174): which kind of time
 * off, as Gusto asks before any field. Five kinds, plus a Holidays card
 * that leaves for the Holiday policy wizard — nobody requests a holiday, it
 * is a calendar fact, but an admin looking for "paid holidays" should still
 * find it here.
 */
export function TimeOffTypePicker() {
  const holiday = POLICY_TYPE_META.holiday;
  const HolidayIcon = holiday.icon;
  return (
    <PolicyWizardShell type="time_off" title="Create time off policy">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A policy is one kind of time off. Pick the kind; the name, the hours and
          the people come next.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TIME_OFF_TYPE_KEYS.map((key) => {
            const meta = TIME_OFF_TYPE_META[key];
            return (
              <li key={key}>
                <Link
                  to={`/settings/hr-policies/new/time-off?type=${key}`}
                  className="flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring outline-none"
                >
                  <span className="text-base font-semibold text-card-foreground">{meta.label}</span>
                  <span className="text-sm text-muted-foreground">{meta.description}</span>
                  <span className="mt-auto text-xs text-muted-foreground">
                    {meta.compensationLocked
                      ? "Always unpaid"
                      : `${meta.defaultCompensation === "paid" ? "Paid" : "Unpaid"} by default`}
                  </span>
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              to={holiday.createPath ?? "/settings/hr-policies"}
              className="flex h-full flex-col gap-2 rounded-xl border border-dashed border-border bg-card p-5 transition-colors hover:border-primary hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring outline-none"
            >
              <span className="flex items-center gap-2 text-base font-semibold text-card-foreground">
                <HolidayIcon className="size-4 text-primary" />
                Holidays
              </span>
              <span className="text-sm text-muted-foreground">
                Paid holidays are a Holiday policy, not time off: nobody requests one. This takes
                you to that wizard.
              </span>
              <span className="mt-auto flex items-center gap-1 text-xs text-primary">
                Create a holiday policy <ArrowRight className="size-3" />
              </span>
            </Link>
          </li>
        </ul>
      </div>
    </PolicyWizardShell>
  );
}
