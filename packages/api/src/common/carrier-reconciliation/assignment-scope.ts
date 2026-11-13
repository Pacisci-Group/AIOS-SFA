import type { ClientSession, Model, Types } from 'mongoose';
import { LIVE_ROW } from './live-row';

type AnyModel = Model<any>;

/**
 * What "a person's open Dash rows" means — one definition, shared by the
 * assignee's page, work transfer and work release, so the count a transfer
 * previews is the list the successor then sees.
 *
 * In a `common/` module behind plain models, like `load-inputs.ts`, because
 * the users services read it too and must not import the reconciliation
 * feature.
 */

/**
 * The runs whose rows are being worked: finished, not replaced by a re-upload
 * of the same report, and not closed by the owner. A superseded run's rows are
 * history — their assignments still name whoever had them then — so nothing
 * that asks "what is this person working on" reads them. Nor a closed month's
 * (PAC-173 review): every month stays its period's current run, so without
 * closing, each upload added a month to everyone's list for good.
 */
export async function currentRunIds(
  runModel: AnyModel,
  agencyId: string,
  session: ClientSession | null = null,
): Promise<Types.ObjectId[]> {
  const runs = await runModel
    .find(
      { agencyId, status: 'ready', supersededByRunId: null, closedAt: null },
      { _id: 1 },
    )
    .session(session)
    .lean<{ _id: Types.ObjectId }[]>();
  return runs.map((run) => run._id);
}

/**
 * Rows on those runs assigned to `userId` that still wait on a decision. A
 * decided row stays assigned to whoever had it — that is the record of who
 * worked it — but it is no longer on anyone's list. So does a row whose
 * outcome they finished while it still asks the owner something: a 1-800
 * service intake carried onto a row whose premium now differs (PAC-173 PR 5).
 *
 * `agencyId` and `assignment.userId` are **strings** on these rows: an
 * ObjectId here would match nothing and say nothing. Ids are stored lower
 * case, so `userId` is lowered too — a route param may arrive in any case.
 */
export function openAssignmentsFilter(
  agencyId: string,
  userId: string,
  runIds: readonly Types.ObjectId[],
) {
  return {
    agencyId,
    runId: { $in: [...runIds] },
    'assignment.userId': userId.toLowerCase(),
    needsReview: true,
    'review.status': 'open' as const,
    'outcome.status': { $ne: 'done' as const },
    // A row a re-upload is replacing right now is about to be copied; a
    // release or transfer written to it would be lost, so it matches nothing.
    ...LIVE_ROW,
  };
}
