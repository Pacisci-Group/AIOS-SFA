import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { AgencyProfileView } from '@sfa/shared';
import { Connection, Model } from 'mongoose';
import { sweepMarkerAfterZoneChange } from '../common/dates/end-of-day';
import { assertMongoKnowsTimeZone } from '../common/dates/mongo-time-zone';
import { DEFAULT_AGENCY_TIME_ZONE } from '../common/dates/time-zones';
import { AccessResolverService } from '../permissions/access-resolver.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import type { UpdateAgencyProfileDto } from './dto/agency-profile.dto';

/**
 * The owner-editable facts about the agency itself (PAC-141). Today: its
 * time zone.
 *
 * ## What a zone change touches
 *
 * 1. **The agency row**, in one conditional write that also re-stamps the Away
 *    sweep marker (`sweepMarkerAfterZoneChange`) — the marker is a date on the
 *    old clock and would otherwise fire or skip one sweep. Conditional on the
 *    zone actually changing, so an unchanged save at 9 PM with the worker down
 *    cannot clear a marker the worker is about to catch up on.
 * 2. **Every cached `AccessContext` in the agency**, which is where the
 *    dashboards read the zone from. Invalidated *after* the write, like a
 *    module toggle; a request racing the write at worst sees the old zone once.
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
      .select('name timezone')
      .lean();
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }
    return {
      agencyName: agency.name,
      // `.lean()` applies no defaults; the backfill makes this unreachable on a
      // migrated database, the fallback is for one that has not run it.
      timezone: agency.timezone ?? DEFAULT_AGENCY_TIME_ZONE,
    };
  }

  async update(
    agencyId: string,
    dto: UpdateAgencyProfileDto,
    now: Date = new Date(),
  ): Promise<AgencyProfileView> {
    const timezone = dto.timezone.trim();

    // The DTO asked the runtime; the dashboards format inside Mongo.
    await assertMongoKnowsTimeZone(this.connection, timezone);

    const result = await this.agencyModel.updateOne(
      { _id: agencyId, timezone: { $ne: timezone } },
      {
        $set: {
          timezone,
          'availabilitySweep.lastAwayDate': sweepMarkerAfterZoneChange(
            now,
            timezone,
          ),
        },
      },
      { runValidators: true },
    );

    if (result.matchedCount > 0) {
      await this.accessResolver.invalidateAgency(agencyId);
    }

    return this.get(agencyId);
  }
}
