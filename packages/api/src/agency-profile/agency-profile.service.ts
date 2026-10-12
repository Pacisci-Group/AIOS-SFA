import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  DEFAULT_AGENCY_END_OF_DAY_HOUR,
  type AgencyProfileView,
} from '@sfa/shared';
import { Connection, Model } from 'mongoose';
import { sweepMarkerAfterScheduleChange } from '../common/dates/end-of-day';
import { assertMongoKnowsTimeZone } from '../common/dates/mongo-time-zone';
import { DEFAULT_AGENCY_TIME_ZONE } from '../common/dates/time-zones';
import { AccessResolverService } from '../permissions/access-resolver.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import type { UpdateAgencyProfileDto } from './dto/agency-profile.dto';

/** What a lean read of the two fields yields — defaults do not apply on `.lean()`. */
type WorkingDayLean = { timezone?: string; endOfDayHour?: number };

/**
 * The owner-editable facts about the agency itself: its working day — the
 * time zone (PAC-141) and the end-of-day Away hour (PAC-149).
 *
 * ## What a change touches
 *
 * 1. **The agency row**, in one conditional write that also re-stamps the Away
 *    sweep marker (`sweepMarkerAfterScheduleChange`) — the marker says whether
 *    tonight ran on the *old* schedule and would otherwise fire or skip one
 *    sweep. Conditional on the zone or the hour actually changing, so an
 *    unchanged save at 9 PM with the worker down cannot clear a marker the
 *    worker is about to catch up on.
 * 2. **Every cached `AccessContext` in the agency — on a zone change only.**
 *    The dashboards read the zone from there; invalidated *after* the write,
 *    like a module toggle, so a request racing the write at worst sees the old
 *    zone once. The hour is not on the context (only the worker reads it), so
 *    an hour-only change leaves the cache alone.
 *
 * It does **not** touch stored day labels — `soldDateYmd`, `quoteDateYmd`,
 * goal months. Those stay on the calendar they were filed on; see
 * `Agency.timezone`.
 */
@Injectable()
export class AgencyProfileService {
  constructor(
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
    @InjectConnection() private connection: Connection,
    private accessResolver: AccessResolverService,
  ) {}

  async get(agencyId: string): Promise<AgencyProfileView> {
    const agency = await this.agencyModel
      .findById(agencyId)
      .select('name timezone endOfDayHour')
      .lean<(WorkingDayLean & { name: string }) | null>();
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }
    return {
      agencyName: agency.name,
      ...workingDay(agency),
    };
  }

  async update(
    agencyId: string,
    dto: UpdateAgencyProfileDto,
    now: Date = new Date(),
  ): Promise<AgencyProfileView> {
    // The DTO asked the runtime; the dashboards format inside Mongo.
    if (dto.timezone !== undefined) {
      await assertMongoKnowsTimeZone(this.connection, dto.timezone);
    }

    // Read first: the marker depends on *both* fields, and a PATCH may name
    // only one — an hour-only change is re-stamped on the stored zone's clock.
    const current = await this.agencyModel
      .findById(agencyId)
      .select('timezone endOfDayHour')
      .lean<WorkingDayLean | null>();
    if (!current) {
      throw new NotFoundException('Agency not found');
    }
    const stored = workingDay(current);
    const timezone = dto.timezone ?? stored.timezone;
    const endOfDayHour = dto.endOfDayHour ?? stored.endOfDayHour;
    const zoneChanged = timezone !== stored.timezone;

    if (!zoneChanged && endOfDayHour === stored.endOfDayHour) {
      return this.get(agencyId);
    }

    // `$ne` also matches a missing field, so a row from before either backfill
    // is written (and given both fields) rather than mistaken for unchanged.
    const result = await this.agencyModel.updateOne(
      {
        _id: agencyId,
        $or: [
          { timezone: { $ne: timezone } },
          { endOfDayHour: { $ne: endOfDayHour } },
        ],
      },
      {
        $set: {
          timezone,
          endOfDayHour,
          'availabilitySweep.lastAwayDate': sweepMarkerAfterScheduleChange(
            now,
            timezone,
            endOfDayHour,
          ),
        },
      },
      { runValidators: true },
    );

    if (zoneChanged && result.matchedCount > 0) {
      await this.accessResolver.invalidateAgency(agencyId);
    }

    return this.get(agencyId);
  }
}

/**
 * The two fields with their defaults. `.lean()` applies no schema defaults;
 * the backfills make the fallbacks unreachable on a migrated database, and
 * they are here for one that has not run them.
 */
function workingDay(
  agency: WorkingDayLean,
): Pick<AgencyProfileView, 'timezone' | 'endOfDayHour'> {
  return {
    timezone: agency.timezone ?? DEFAULT_AGENCY_TIME_ZONE,
    endOfDayHour: agency.endOfDayHour ?? DEFAULT_AGENCY_END_OF_DAY_HOUR,
  };
}
