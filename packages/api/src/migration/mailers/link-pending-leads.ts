import { mongo, Types } from 'mongoose';

/**
 * Link the leads that were waiting on a mailer to the mailers a backfill run
 * just wrote.
 *
 * ## Who is waiting
 *
 * A lead whose `mailer.controlNumberKey` is set while `mailer.mailerId` is
 * null: it carries a Quote Control Number whose mailer was not in AIOS when the
 * lead was created or migrated. On the September 2026 production copy, 606
 * leads were in that state, and 102 of their keys belonged to files the
 * cutover import had skipped.
 *
 * ## Only uncontested links
 *
 * This follows `backfillLeadLinks` in the PAC-71 backfill, not the campaign
 * commit's `reconcileLeads`. A mailer claimed by exactly one waiting lead is
 * linked. A mailer claimed by several is reported and left alone: the unique
 * index allows only one of them, and picking whichever lead the cursor returned
 * first would decide a campaign's attribution by chance. The commit links
 * first-come because its leads were typed in by producers against one upload;
 * a historical backfill over leads nobody is watching has no such excuse.
 *
 * Claims are grouped by **mailer**, not by key. The long and short printed
 * forms are different keys for the same mailer, and grouping by key lets two
 * leads through as "unique" (pass 2 of `backfillLeadLinks` documents the E11000
 * that caused).
 *
 * Uses the raw driver collection rather than a `Lead` model, so the CLI never
 * compiles the `Lead` schema and never runs its `autoIndex` against
 * production.
 */

/** The mailer a key resolves to, as the lead will store it. */
export interface ResolvedMailer {
  mailerId: string;
  campaignId: string;
}

export interface PendingLeadClaim {
  leadId: string;
  key: string;
  mailer: ResolvedMailer | null;
}

export interface LeadLink {
  leadId: string;
  key: string;
  mailerId: string;
  campaignId: string;
}

export interface LeadLinkConflict {
  mailerId: string;
  leadIds: string[];
}

export interface LeadLinkPlan {
  links: LeadLink[];
  conflicts: LeadLinkConflict[];
  /** Waiting leads whose key matched nothing this run wrote. */
  unmatched: number;
}

/** Decide which claims become links. Pure, so the rule is testable alone. */
export function planLeadLinks(
  claims: readonly PendingLeadClaim[],
): LeadLinkPlan {
  const byMailer = new Map<
    string,
    { mailer: ResolvedMailer; claims: PendingLeadClaim[] }
  >();
  let unmatched = 0;

  for (const claim of claims) {
    if (!claim.mailer) {
      unmatched += 1;
      continue;
    }
    const entry = byMailer.get(claim.mailer.mailerId) ?? {
      mailer: claim.mailer,
      claims: [],
    };
    entry.claims.push(claim);
    byMailer.set(claim.mailer.mailerId, entry);
  }

  const links: LeadLink[] = [];
  const conflicts: LeadLinkConflict[] = [];
  for (const [mailerId, entry] of byMailer) {
    if (entry.claims.length > 1) {
      conflicts.push({
        mailerId,
        leadIds: entry.claims.map((claim) => claim.leadId),
      });
      continue;
    }
    const [claim] = entry.claims;
    links.push({
      leadId: claim.leadId,
      key: claim.key,
      mailerId,
      campaignId: entry.mailer.campaignId,
    });
  }

  return { links, conflicts, unmatched };
}

export interface LeadLinkReport {
  /** Waiting leads in the agencies this run imported into. */
  pendingLeads: number;
  /** Of those, the ones whose key resolved to a mailer this run wrote. */
  matchedLeads: number;
  /** Links written, or on a dry run, links that would be written. */
  linked: number;
  linkedLeadIds: string[];
  conflicts: LeadLinkConflict[];
  /**
   * Planned links another writer took first, typically a producer logging the
   * same mailer from the drawer while the run was going.
   */
  lostRace: string[];
}

interface PendingLeadDoc {
  _id: Types.ObjectId;
  agencyId: string;
  mailer?: { controlNumberKey?: string };
}

export async function linkPendingLeads(
  db: mongo.Db,
  input: {
    agencyIds: readonly string[];
    dryRun: boolean;
    /** The mailer this run wrote for `key` that `agencyId` may see, if any. */
    resolve: (key: string, agencyId: string) => Promise<ResolvedMailer | null>;
  },
): Promise<LeadLinkReport> {
  const leads = db.collection('leads');

  // `agencyId` is a string on every `TenantRecord`, leads included.
  const pending = await leads
    .find({
      agencyId: { $in: [...input.agencyIds] },
      'mailer.mailerId': null,
      'mailer.controlNumberKey': { $type: 'string' },
    })
    .project<PendingLeadDoc>({ agencyId: 1, 'mailer.controlNumberKey': 1 })
    .toArray();

  const claims: PendingLeadClaim[] = [];
  for (const lead of pending) {
    const key = lead.mailer?.controlNumberKey;
    if (!key) continue;
    claims.push({
      leadId: lead._id.toString(),
      key,
      mailer: await input.resolve(key, lead.agencyId),
    });
  }

  const plan = planLeadLinks(claims);
  const report: LeadLinkReport = {
    pendingLeads: pending.length,
    matchedLeads: claims.length - plan.unmatched,
    linked: 0,
    linkedLeadIds: [],
    conflicts: plan.conflicts,
    lostRace: [],
  };

  if (input.dryRun) {
    report.linked = plan.links.length;
    report.linkedLeadIds = plan.links.map((link) => link.leadId);
    return report;
  }

  const linkedAt = new Date();
  for (const link of plan.links) {
    try {
      // Only ever *fills* a link: conditioned on the lead still waiting, so a
      // link made in the meantime is reported rather than overwritten.
      const result = await leads.updateOne(
        { _id: new Types.ObjectId(link.leadId), 'mailer.mailerId': null },
        {
          $set: {
            'mailer.mailerId': new Types.ObjectId(link.mailerId),
            'mailer.campaignId': link.campaignId,
            'mailer.matchedBy': 'control_number',
            'mailer.linkedAt': linkedAt,
            // Null: a script made this link, not a person.
            'mailer.linkedBy': null,
          },
        },
      );
      if (result.modifiedCount > 0) {
        report.linked += 1;
        report.linkedLeadIds.push(link.leadId);
      } else {
        report.lostRace.push(link.leadId);
      }
    } catch (error) {
      // E11000 on `mailer.mailerId_1`: another lead owns this mailer now.
      if ((error as { code?: number }).code === 11000) {
        report.lostRace.push(link.leadId);
        continue;
      }
      throw error;
    }
  }

  return report;
}
