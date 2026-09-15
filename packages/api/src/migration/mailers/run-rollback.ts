import { mongo } from 'mongoose';

/**
 * How to undo a live add-only backfill run, worked out from the database
 * rather than from what one pass of the run happened to do.
 *
 * ## Why from the database
 *
 * An add-only run is re-runnable, and a re-run of a finished import writes
 * nothing. A report built from "what this pass did" would therefore list no
 * leads and no campaigns, and its undo would delete every mailer under the run
 * id while leaving the leads the *first* pass linked pointing at nothing. Read
 * back from everything that carries the run id, the latest report's rollback
 * undoes the whole import.
 *
 * The same property covers a run that died before writing its report: run the
 * same command again. It inserts only what is still missing, and its report
 * carries the rollback for all of it.
 *
 * ## What it undoes, in order
 *
 * 1. **Leads** linked to one of the run's mailers go back to waiting: the link
 *    is cleared and the control-number key stays. That includes a lead a
 *    producer logged from the drawer after the import, whose mailer is about to
 *    disappear either way.
 * 2. **Mailers** carrying the run id are deleted. An add-only run stamps its id
 *    on its own inserts and nothing else, which is why an upsert gets no plan.
 * 3. **Campaigns** the deletion leaves empty are deleted, and only implicit
 *    (`source: 'migration'`) ones.
 */
export interface RunRollbackPlan {
  runId: string;
  /** Mailers carrying the run id. */
  mailers: number;
  /** Leads linked to one of those mailers. */
  leadIds: string[];
  /** Campaigns holding no other mailers. */
  campaignIds: string[];
  /** mongosh commands, in the order to run them. */
  commands: string[];
}

export async function planRunRollback(
  db: mongo.Db,
  runId: string,
): Promise<RunRollbackPlan> {
  const mailers = db.collection('mailers');
  const leads = db.collection('leads');

  const count = await mailers.countDocuments({ 'source.runId': runId });
  const runCampaignIds = (await mailers.distinct('campaignId', {
    'source.runId': runId,
  })) as string[];

  const campaignIds: string[] = [];
  for (const campaignId of runCampaignIds) {
    // Backed by the `{ campaignId, source.runId }` index.
    const other = await mailers.findOne(
      { campaignId, 'source.runId': { $ne: runId } },
      { projection: { _id: 1 } },
    );
    if (!other) campaignIds.push(campaignId);
  }

  // A lead stores its mailer's campaign, so the run's campaigns narrow the
  // leads to a handful before any id is compared.
  const linked = await leads
    .find({
      'mailer.campaignId': { $in: runCampaignIds },
      'mailer.mailerId': { $type: 'objectId' },
    })
    .project<{ _id: mongo.ObjectId; mailer: { mailerId: mongo.ObjectId } }>({
      'mailer.mailerId': 1,
    })
    .toArray();
  const runMailerIds = new Set(
    (
      await mailers
        .find({
          _id: { $in: linked.map((lead) => lead.mailer.mailerId) },
          'source.runId': runId,
        })
        .project<{ _id: mongo.ObjectId }>({ _id: 1 })
        .toArray()
    ).map((mailer) => mailer._id.toString()),
  );
  const leadIds = linked
    .filter((lead) => runMailerIds.has(lead.mailer.mailerId.toString()))
    .map((lead) => lead._id.toString());

  return {
    runId,
    mailers: count,
    leadIds,
    campaignIds,
    commands: rollbackCommands(runId, leadIds, campaignIds),
  };
}

/** The mongosh text for a plan. Pure, so its order and guards are testable. */
export function rollbackCommands(
  runId: string,
  leadIds: readonly string[],
  campaignIds: readonly string[],
): string[] {
  const ids = (values: readonly string[]) =>
    values.map((id) => `ObjectId('${id}')`).join(', ');

  const commands: string[] = [];
  if (leadIds.length > 0) {
    // First: a lead must never point at a mailer that no longer exists, even
    // for the moment between two commands.
    commands.push(
      `db.leads.updateMany({ _id: { $in: [${ids(leadIds)}] } }, ` +
        `{ $set: { 'mailer.mailerId': null, 'mailer.campaignId': null }, ` +
        `$unset: { 'mailer.matchedBy': '', 'mailer.linkedAt': '' } })`,
    );
  }
  commands.push(
    `db.mailers.deleteMany({ 'source.runId': ${JSON.stringify(runId)} })`,
  );
  if (campaignIds.length > 0) {
    commands.push(
      `db.mailerCampaigns.deleteMany({ _id: { $in: [${ids(campaignIds)}] }, source: 'migration' })`,
    );
  }
  return commands;
}
