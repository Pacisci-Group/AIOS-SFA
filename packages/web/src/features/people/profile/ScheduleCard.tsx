import { Clock } from "lucide-react";
import { WEEKDAY_LABELS, type PersonScheduleView } from "@sfa/shared";
import { DataRow, DetailCard } from "@/components/common/DetailCard";
import {
  formatClock,
  formatHours,
  formatWeekdays,
} from "@/features/hr/policies/policy-display";

/**
 * The person's week, as their Work week and Holiday policies say (PAC-162).
 * Nobody clocks in, so the hours a week are computed from the schedule —
 * "Mon–Fri · 9:00 AM – 5:00 PM · 40h a week" when the days share hours, a
 * line per day otherwise.
 */
export function ScheduleCard({ schedule }: { schedule: PersonScheduleView }) {
  const { days } = schedule;
  const sameHours = days.every(
    (day) => day.start === days[0]?.start && day.end === days[0]?.end,
  );

  return (
    <DetailCard title="Schedule" icon={Clock}>
      <div className="grid gap-4">
        <DataRow
          label="Work week"
          value={
            <span>
              <span className="font-medium">{schedule.workWeek?.name ?? "Default week"}</span>
              <span className="text-muted-foreground">
                {" · "}
                {formatHours(schedule.hoursPerWeek)} a week
              </span>
            </span>
          }
        />
        {sameHours && days[0] ? (
          <DataRow
            label="Hours"
            value={`${formatWeekdays(days)} · ${formatClock(days[0].start)} – ${formatClock(days[0].end)}`}
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hours</p>
            <ul className="text-base text-card-foreground">
              {days.map((day) => (
                <li key={day.weekday} className="flex justify-between gap-3">
                  <span>{WEEKDAY_LABELS[day.weekday]}</span>
                  <span className="text-muted-foreground">
                    {formatClock(day.start)} – {formatClock(day.end)}
                  </span>
                </li>
              ))}
              {days.length === 0 && <li className="text-muted-foreground">No working days</li>}
            </ul>
          </div>
        )}
        <DataRow label="Holidays" value={schedule.holiday?.name ?? "No holiday policy"} />
      </div>
    </DetailCard>
  );
}
