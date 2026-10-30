import type { ClientSession, Model, Types } from 'mongoose';

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
 * The runs whose rows are current: finished, and not replaced by a re-upload
 * of the same report. A superseded run's rows are history — their
 * assignments still name whoever had them then — so nothing that asks "what
 * is this person working on" reads them.
 */
export async function currentRunIds(
  runModel: AnyModel,
  agencyId: string,
  session: ClientSession | null = null,
): Promise<Types.ObjectId[]> {
  const runs = await runModel
    .find({ agencyId, status: 'ready', supersededByRunId: null }, { _id: 1 })
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
  };
}
