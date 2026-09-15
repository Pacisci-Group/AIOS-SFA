import { rollbackCommands } from './run-rollback';

const LEAD = '6a95f3a5f8b8430db6d78356';
const CAMPAIGN = '6aa91e0d45ffe9490acde59b';

describe('rollbackCommands', () => {
  it('unlinks leads first, deletes mailers, then deletes the emptied campaigns', () => {
    expect(
      rollbackCommands('bigquery:catchup-2026-09', [LEAD], [CAMPAIGN]),
    ).toEqual([
      `db.leads.updateMany({ _id: { $in: [ObjectId('${LEAD}')] } }, ` +
        `{ $set: { 'mailer.mailerId': null, 'mailer.campaignId': null }, ` +
        `$unset: { 'mailer.matchedBy': '', 'mailer.linkedAt': '' } })`,
      `db.mailers.deleteMany({ 'source.runId': "bigquery:catchup-2026-09" })`,
      // Guarded to implicit campaigns: an operator's real campaign is never
      // removed by a backfill's undo, whatever id ends up in the list.
      `db.mailerCampaigns.deleteMany({ _id: { $in: [ObjectId('${CAMPAIGN}')] }, source: 'migration' })`,
    ]);
  });

  it('leaves out the lead and campaign steps when there is nothing to undo there', () => {
    expect(rollbackCommands('bigquery:catchup-2026-09', [], [])).toEqual([
      `db.mailers.deleteMany({ 'source.runId': "bigquery:catchup-2026-09" })`,
    ]);
  });
});
