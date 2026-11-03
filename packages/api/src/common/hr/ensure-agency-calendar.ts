import { DEFAULT_CALENDAR_COUNTRY, DEFAULT_WORKWEEK } from '@sfa/shared';
import type { Model, Types } from 'mongoose';
import type { AgencyCalendar } from '../../hr/schemas/agency-calendar.schema';
import { regionFromStateName } from '../working-days/holiday-suggestions';

export interface EnsureAgencyCalendarHints {
  /** ISO 3166-1 alpha-2; the platform default when omitted. */
  country?: string | null;
  /** Free text — `Branch.address.state` as typed — mapped onto a region code. */
  regionHint?: string | null;
}

/**
 * Find-or-create the agency's calendar document (PAC-161): the workweek and
 * the country/region, **nothing else**. No holiday rows — those need a
 * person to tick them (see `hr-calendar.ts`) — and no leave policy — an
 * agency may hold none (Asad, 2026-10-22).
 *
 * Called by both provisioning paths (`provisionTenant` for the migration and
 * the demo seed, `AgencyProvisioningService` for the panel wizard). The
 * `hr_module` migration does the same for agencies that predate it, with
 * the logic copied in.
 */
export async function ensureAgencyCalendar(
  calendarModel: Model<AgencyCalendar>,
  agencyId: string | Types.ObjectId,
  hints: EnsureAgencyCalendarHints = {},
): Promise<{ id: Types.ObjectId; created: boolean }> {
  const id = String(agencyId);
  const existing = await calendarModel
    .findOne({ agencyId: id })
    .select('_id')
    .lean<{ _id: Types.ObjectId } | null>();
  if (existing) return { id: existing._id, created: false };

  const country = (hints.country ?? DEFAULT_CALENDAR_COUNTRY).toUpperCase();
  const created = await calendarModel.create({
    agencyId: id,
    workweek: [...DEFAULT_WORKWEEK],
    country,
    region: regionFromStateName(country, hints.regionHint),
    proposals: [],
  });
  return { id: created._id, created: true };
}
