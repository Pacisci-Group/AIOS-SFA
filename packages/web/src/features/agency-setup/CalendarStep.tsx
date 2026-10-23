import { CalendarTab } from "@/features/hr/settings/calendar/CalendarTab";

/**
 * The Calendar phase of the owner's first-run setup (PAC-161).
 *
 * The same calendar editor as `/settings/hr`, with every write a real save:
 * the working week and the country/region through the Working week card, and
 * holidays through "Import holidays for YEAR" (public ones ticked, the rest
 * not). Country and region arrive pre-filled from the branch address the
 * operator typed. Skipping writes nothing — the Mon–Fri workweek already
 * exists, which is a working calendar.
 */
export function CalendarStep() {
  return <CalendarTab canWrite />;
}
