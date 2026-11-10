import { Injectable } from '@nestjs/common';
import type { Types } from 'mongoose';

/**
 * Where a person's hire date comes from (PAC-174 reads it, PAC-162 stores it).
 *
 * The hire-anniversary reset and the usage waiting period both read a
 * `hireDate`, and the decision (2026-11-04) is that it is **nullable**: a
 * person without one has no waiting period applied and no anniversary reset
 * until it is set. Today nobody has one — the People page (PAC-162) adds
 * `employeeProfiles.hireDate` — so this returns `null` for everyone, and the
 * callers already handle that answer.
 *
 * PAC-162: read the profiles here and nowhere else. The accrual job and the
 * request rules (PAC-165) must never grow their own lookup.
 */
@Injectable()
export class HireDatesService {
  /** `YYYY-MM-DD` per user id, `null` while unset. Every id asked for is present. */
  forUsers(
    _agencyId: string,
    userIds: readonly Types.ObjectId[],
  ): Promise<Map<string, string | null>> {
    return Promise.resolve(new Map(userIds.map((id) => [id.toString(), null])));
  }
}
