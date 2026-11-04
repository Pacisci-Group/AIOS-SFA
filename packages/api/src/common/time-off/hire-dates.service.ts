import { Injectable } from '@nestjs/common';
import type { Types } from 'mongoose';
import { EmployeeProfilesService } from '../hr/employee-profiles.service';

/**
 * Where a person's hire date comes from (PAC-174 reads it, PAC-162 stores it).
 *
 * The hire-anniversary reset and the usage waiting period both read a
 * `hireDate`, and the decision (2026-11-04) is that it is **nullable**: a
 * person without one has no waiting period applied and no anniversary reset
 * until an HR admin completes their onboarding on the People page. The
 * callers handle `null`.
 *
 * The accrual job and the request rules (PAC-165) read it here and nowhere
 * else, so there is one answer to "when was this person hired".
 */
@Injectable()
export class HireDatesService {
  constructor(private readonly profiles: EmployeeProfilesService) {}

  /** `YYYY-MM-DD` per user id, `null` while unset. Every id asked for is present. */
  forUsers(
    agencyId: string,
    userIds: readonly Types.ObjectId[],
  ): Promise<Map<string, string | null>> {
    return this.profiles.hireDates(agencyId, userIds);
  }
}
