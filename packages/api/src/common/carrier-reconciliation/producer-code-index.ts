import type { BindIdStatus } from '@sfa/shared';
import type { DashRow } from './dash-file-reader';

/**
 * One user's Allstate codes, as the engine reads them (`loadStaffCodes`).
 * Codes are already normalised — the user write paths store them that way.
 */
export interface StaffCodes {
  userId: string;
  name: string;
  bindId: string | null;
  subProducerCode: string | null;
}

/** The agency's users, looked up by either Allstate code. */
export class ProducerCodeIndex {
  private readonly byBindId = new Map<string, StaffCodes>();
  private readonly bySubProducer = new Map<string, StaffCodes>();

  constructor(staff: readonly StaffCodes[]) {
    for (const entry of staff) {
      if (entry.bindId) this.byBindId.set(entry.bindId, entry);
      if (entry.subProducerCode) {
        this.bySubProducer.set(entry.subProducerCode, entry);
      }
    }
  }

  bindId(key: string | null): StaffCodes | undefined {
    return key ? this.byBindId.get(key) : undefined;
  }

  subProducer(key: string | null): StaffCodes | undefined {
    return key ? this.bySubProducer.get(key) : undefined;
  }
}

/**
 * Whose login bound the policy. The 1-800 test reads **only** this: a
 * producer binding a colleague's sale is routine, so the sub-producer column
 * says nothing about whether the agency sold it.
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
  /** The sub-producer code Dash credits, when it names one. */
  code: string | null;
  /** The name Dash prints for whoever is credited. */
  name: string | null;
  /** The app user holding that code, when one does. */
  userId: string | null;
  /** `bind_id` with no `userId` is a former employee Dash names. */
  via: 'sub_producer' | 'bind_id' | 'none';
}

/**
 * Who Dash credits with the sale — the scrubber's rule: the sub-producer, or
 * when the line has none, whoever bound it.
 *
 * A sub-producer code on no user does **not** fall back to the Bind ID: the
 * line names someone, and crediting the binder instead would hide that the
 * code is missing from that person's profile.
 *
 * A Bind ID on no user that Dash names is still credited to that name — a
 * former employee ({@link bindIdStatus}) — with no `userId`.
 */
export function creditFor(
  row: Pick<
    DashRow,
    'subProducerCode' | 'subProducerName' | 'bindIdKey' | 'bindIdName'
  >,
  codes: ProducerCodeIndex,
): DashCredit {
  if (row.subProducerCode) {
    const holder = codes.subProducer(row.subProducerCode);
    return {
      code: row.subProducerCode,
      name: row.subProducerName ?? holder?.name ?? null,
      userId: holder?.userId ?? null,
      via: 'sub_producer',
    };
  }
  const binder = codes.bindId(row.bindIdKey);
  if (binder) {
    return {
      code: null,
      name: row.bindIdName ?? binder.name,
      userId: binder.userId,
      via: 'bind_id',
    };
  }
  if (row.bindIdKey && row.bindIdName) {
    return { code: null, name: row.bindIdName, userId: null, via: 'bind_id' };
  }
  // Credited to nobody — and named as nobody, so the summary's `none` line
  // never borrows a person's name from a stray Bind ID Name.
  return { code: null, name: null, userId: null, via: 'none' };
}
