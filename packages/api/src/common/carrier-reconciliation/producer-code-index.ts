import type { BindIdStatus } from '@sfa/shared';
import type { DashRow } from './dash-file-reader';

/**
 * One user's Allstate Bind ID, as the engine reads it (`loadStaffCodes`).
 * Already normalised — the user write paths store it that way.
 */
export interface StaffCodes {
  userId: string;
  name: string;
  bindId: string | null;
}

/** The agency's users, looked up by Bind ID. */
export class ProducerCodeIndex {
  private readonly byBindId = new Map<string, StaffCodes>();

  constructor(staff: readonly StaffCodes[]) {
    for (const entry of staff) {
      if (entry.bindId) this.byBindId.set(entry.bindId, entry);
    }
  }

  bindId(key: string | null): StaffCodes | undefined {
    return key ? this.byBindId.get(key) : undefined;
  }
}

/**
 * Whose login bound the policy — the 1-800 test, and who the line belongs to
 * ({@link creditFor}).
 *
 * A Bind ID on no user is a **former employee** when Dash prints a Bind ID
 * Name beside it — the owner's rule (David, 27 Oct 2026): only an unnamed
 * login is 1-800. On the Jul–Sep 2026 export the named logins on no user were
 * all people who had worked at the agency (Brian Carter, Marco Perez, Jacob
 * Landrum, …); the unnamed ones were Allstate's call centre (`OSCVANJ`),
 * 18-digit machine ids and a handful of others.
 */
export function bindIdStatus(
  row: Pick<DashRow, 'bindIdKey' | 'bindIdName'>,
  codes: ProducerCodeIndex,
): BindIdStatus {
  if (!row.bindIdKey) return 'blank';
  if (codes.bindId(row.bindIdKey)) return 'staff';
  return row.bindIdName ? 'former_staff' : 'not_staff';
}

export interface DashCredit {
  /** The binder's name: the app user's, else the name Dash prints. */
  name: string | null;
  /** The app user holding the Bind ID, when one does. */
  userId: string | null;
  /** `bind_id` with no `userId` is a former employee Dash names. */
  via: 'bind_id' | 'none';
}

/**
 * Who a Dash line belongs to: the user whose **Bind ID** bound it, by the
 * name the app knows them by.
 *
 * Dash's sub-producer column is not read (owner, 28 Oct 2026). Grouping by it
 * listed one person twice — "JESSICA YATES (034)" for the lines Dash credits
 * by code and "Jessica Yates" for the app's own policies — whenever the code
 * was not on their user, and on the Jul–Sep 2026 export it named the binder
 * on 374 of 382 sales anyway.
 *
 * A Bind ID on no user that Dash names is credited to that name — a former
 * employee ({@link bindIdStatus}) — with no `userId`.
 */
export function creditFor(
  row: Pick<DashRow, 'bindIdKey' | 'bindIdName'>,
  codes: ProducerCodeIndex,
): DashCredit {
  const binder = codes.bindId(row.bindIdKey);
  if (binder) {
    return { name: binder.name, userId: binder.userId, via: 'bind_id' };
  }
  if (row.bindIdKey && row.bindIdName) {
    return { name: row.bindIdName, userId: null, via: 'bind_id' };
  }
  // Credited to nobody — and named as nobody, so the summary's `none` line
  // never borrows a person's name from a stray Bind ID Name.
  return { name: null, userId: null, via: 'none' };
}
