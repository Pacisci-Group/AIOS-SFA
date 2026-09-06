import type {
  MailerAssignmentResolution,
  MailerCampaignAssignment,
} from '@sfa/shared';

/**
 * Who each row of a vendor file belongs to (PAC-71).
 *
 * A campaign is run **once** and can serve many agencies, so "which tenant" is
 * decided per row rather than per upload. This module is the whole of that
 * decision, and it is used three times over one campaign's life — at preview
 * (so the operator sees the answer before anything is written), at the commit
 * gate (appointments may have changed in between), and inside the commit job
 * itself (to build `visibleAgencyIdsFor`). All three must agree, which is why it
 * is one pure function rather than a query written out three times.
 *
 * ## The three modes
 *
 * - `carrier_agency_id` — **the default, and the only one that reads the file.**
 *   The row's own `agencyid` column is matched against the carrier appointments
 *   (PAC-93) held under the campaign's carrier. Nobody picks; the file says
 *   whose it is. A code no agency holds is reported and **blocks the commit** —
 *   filing one agency's prospects under another, or dropping them silently, are
 *   both worse than refusing.
 * - `agencies` — the operator named the agencies; every row goes to all of them.
 * - `all` — every agency, including ones onboarded later, so the *mode* is
 *   stored and `visibleAgencyIds` is an explicit `null`.
 *
 * ## Import boundary
 *
 * `common/`, so the worker may import it. It takes its model as an argument
 * (structurally, not as `Model<Agency>`) for the same reason `importMailerRows`
 * does: `common/` must not reach into a feature directory's schema, and a
 * structural type is satisfied by a real model and by a fake in a test alike.
 */

/**
 * The code key a row carries when its `agencyid` column is empty.
 *
 * A real key, not a sentinel to be filtered out: in `carrier_agency_id` mode a
 * blank code is exactly as unassignable as a wrong one, and it has to appear in
 * the preview's unmatched list with a label an operator can read.
 */
export const BLANK_CARRIER_CODE = '(blank)';

/** The slice of an agency this module reads. */
export interface AppointmentAgencyRow {
  _id: unknown;
  name?: string;
  carrierAppointments?: {
    carrierId?: unknown;
    codeKey?: string;
    active?: boolean;
  }[];
}

/**
 * The only thing this needs from `Model<Agency>`.
 *
 * Structural for the reasons in the module note. A `Model` satisfies it as-is;
 * `PromiseLike` rather than `Promise` because a Mongoose `Query` is a thenable
 * and not an actual `Promise`.
 */
export interface AgencyAppointmentModel {
  find(filter: Record<string, unknown>): {
    select(projection: Record<string, number>): {
      lean(): PromiseLike<AppointmentAgencyRow[]>;
    };
  };
}

export interface ResolveAssignmentInput {
  /** The campaign's carrier. A code only means anything inside its own. */
  carrierId: unknown;
  assignment: MailerCampaignAssignment;
}

export interface ResolvedAssignment {
  /**
   * Code key → the agencies a row carrying it is visible to.
   *
   * `null` = every agency; **absent** = unassignable, which `mapMailerRow` turns
   * into a counted rejection. The two are deliberately different: one is a
   * decision, the other is the absence of one.
   */
  byCodeKey: Record<string, string[] | null>;
  /** Codes matching no agency. Non-empty blocks the commit. */
  unmatched: string[];
  /** The preview's assignment table, one row per distinct code in the file. */
  resolved: MailerAssignmentResolution[];
}

/**
 * Match the file's carrier agency codes against the appointment catalog.
 *
 * `codeCounts` is code key → rows carrying it, built by the caller while it
 * reads the file (blank codes counted under {@link BLANK_CARRIER_CODE}). Passing
 * counts rather than rows is what keeps this callable from a worker step whose
 * result is memoized as JSON.
 */
export async function resolveAssignment(
  agencyModel: AgencyAppointmentModel,
  { carrierId, assignment }: ResolveAssignmentInput,
  codeCounts: Record<string, number>,
): Promise<ResolvedAssignment> {
  const codeKeys = Object.keys(codeCounts);

  if (assignment.mode === 'all') {
    // Every code, including ones this file does not carry — see
    // `visibleAgencyIdsFor`, which short-circuits this mode anyway.
    return {
      byCodeKey: Object.fromEntries(codeKeys.map((key) => [key, null])),
      unmatched: [],
      // agencyId/agencyName stay null: in this mode the codes are provenance,
      // not the audience. `campaign.assignment` is what says who can see it.
      resolved: codeKeys.map((codeKey) => ({
        codeKey,
        agencyId: null,
        agencyName: null,
        rows: codeCounts[codeKey],
      })),
    };
  }

  if (assignment.mode === 'agencies') {
    const agencyIds = [...assignment.agencyIds];
    return {
      byCodeKey: Object.fromEntries(codeKeys.map((key) => [key, agencyIds])),
      unmatched: [],
      resolved: codeKeys.map((codeKey) => ({
        codeKey,
        agencyId: null,
        agencyName: null,
        rows: codeCounts[codeKey],
      })),
    };
  }

  // --- carrier_agency_id ----------------------------------------------------

  // A blank code can never match an appointment (`codeKey` is a required,
  // non-empty string there), so it is excluded from the query rather than
  // sent as a value that would match nothing but still cost an index seek.
  const realKeys = codeKeys.filter((key) => key !== BLANK_CARRIER_CODE);

  const agencies =
    realKeys.length === 0
      ? []
      : await agencyModel
          // `$elemMatch`, not two dotted paths. `{ 'a.carrierId': x,
          // 'a.codeKey': y }` matches a document where *different* array
          // elements satisfy each clause — an independent agency holding
          // carrier A under code 1 and carrier B under code 2 would match the
          // cross product. The compound `CARRIER_APPOINTMENT_LOOKUP_KEY` index
          // is built to serve exactly this parse.
          .find({
            carrierAppointments: {
              $elemMatch: {
                carrierId,
                codeKey: { $in: realKeys },
                active: true,
              },
            },
          })
          .select({ _id: 1, name: 1, carrierAppointments: 1 })
          .lean();

  const carrierKey = String(carrierId);
  const owners = new Map<string, { id: string; name: string }>();
  for (const agency of agencies) {
    // `.lean()` applies no schema defaults, so an agency created before PAC-93
    // reads as `undefined` rather than `[]`.
    for (const appointment of agency.carrierAppointments ?? []) {
      if (!appointment.active || !appointment.codeKey) continue;
      if (String(appointment.carrierId) !== carrierKey) continue;
      if (!realKeys.includes(appointment.codeKey)) continue;
      // At most one agency can hold a given (carrier, code) — the unique
      // partial index on `Agency` enforces it — so last-write-wins here is
      // unreachable rather than a policy.
      owners.set(appointment.codeKey, {
        id: String(agency._id),
        name: agency.name ?? '',
      });
    }
  }

  const byCodeKey: Record<string, string[] | null> = {};
  const unmatched: string[] = [];
  const resolved: MailerAssignmentResolution[] = [];

  for (const codeKey of codeKeys) {
    const owner = owners.get(codeKey);
    if (owner) {
      byCodeKey[codeKey] = [owner.id];
    } else {
      // Deliberately **not** written to `byCodeKey`: absent is what
      // `mapMailerRow` reads as "reject this row and say why".
      unmatched.push(codeKey);
    }
    resolved.push({
      codeKey,
      agencyId: owner?.id ?? null,
      agencyName: owner?.name ?? null,
      rows: codeCounts[codeKey],
    });
  }

  return { byCodeKey, unmatched, resolved };
}

/**
 * The message the preview shows and the commit refuses on.
 *
 * Written as an instruction rather than a diagnosis: the operator can fix this
 * two ways and both are named, because "A0B9049 matches no agency" leaves them
 * looking for a setting they have no reason to know exists.
 */
export function unmatchedCodeMessage(
  codeKey: string,
  rows: number,
  carrierName: string,
): string {
  const code = codeKey === BLANK_CARRIER_CODE ? 'no agency code' : codeKey;
  return (
    `No agency holds an active ${carrierName} appointment for ${code} ` +
    `(${rows.toLocaleString('en-US')} rows). Add the appointment on the agency, ` +
    `or switch assignment to "Specific agencies".`
  );
}

/**
 * Build the per-row audience function the import engine takes.
 *
 * ⚠ `all` short-circuits rather than reading the map. The map is built from the
 * codes the *preview* saw; if the commit's read of the file ever produced a code
 * the preview did not, a map lookup would return `undefined` and the engine
 * would reject a row that is explicitly visible to everyone. Fail-closed is
 * right for the code-matching mode and wrong for this one.
 */
export function visibleAgencyIdsFor(
  assignment: MailerCampaignAssignment,
  byCodeKey: Record<string, string[] | null>,
): (codeKey: string | null) => string[] | null | undefined {
  if (assignment.mode === 'all') return () => null;
  if (assignment.mode === 'agencies') {
    const agencyIds = [...assignment.agencyIds];
    return () => agencyIds;
  }
  return (codeKey) => byCodeKey[codeKey ?? BLANK_CARRIER_CODE];
}
