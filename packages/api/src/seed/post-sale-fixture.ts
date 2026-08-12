import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { AccessScope, DataScope } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { AuditGenerationService } from '../audit-generation/audit-generation.service';
import { AuditTemplate } from '../audit-templates/schemas/audit-template.schema';
import { Onboarding } from '../crm/schemas/onboarding.schema';
import { ServiceTicket } from '../crm/schemas/service-ticket.schema';
import { ServiceTicketsService } from '../crm/service-tickets.service';
import { DealAuditItem } from '../deal-audit-items/schemas/deal-audit-item.schema';
import { DealAudit } from '../deal-audits/schemas/deal-audit.schema';
import { DealAuditsService } from '../deal-audits/deal-audits.service';
import { Deal } from '../deals/schemas/deal.schema';
import { Household } from '../households/schemas/household.schema';
import { Lead } from '../leads/schemas/lead.schema';
import { Policy } from '../policies/schemas/policy.schema';
import { User } from '../users/schemas/user.schema';
import { seedAuditTemplates } from './audit-templates.seed';

/**
 * Carry one already-sold lead through the rest of the post-sale flow: generate
 * its hand-off audit, pass it, and start onboarding.
 *
 *   npx ts-node -r tsconfig-paths/register src/seed/post-sale-fixture.ts <leadId>
 *   npx ts-node -r tsconfig-paths/register src/seed/post-sale-fixture.ts <leadId> --clean
 *
 * This is a **dev fixture**, not production seed data, and is not wired into
 * any npm script — the same bargain `scroll-fixtures.ts` makes. It exists
 * because two links in the chain have no UI or endpoint behind them yet:
 * audit generation only runs as a post-commit side-effect of the Sold form,
 * and nothing calls `startOnboarding` on audit approval (TODO(PAC-14) on
 * `ServiceTicketsService.create`). Until those land, this is how you get a
 * lead into the state a CSR actually works from.
 *
 * It drives the real services rather than writing documents, so what it
 * produces is what the app would have produced: `AuditGenerationService`
 * computes the checklist from the deal's policy types and discount triggers,
 * and `DealAuditsService.resolveItem` resolves each item through the same path
 * the hand-off board's button uses (activity log included).
 *
 * Idempotent. Audit generation upserts on a dedupe key, resolving is one-shot,
 * and `startOnboarding` returns the existing onboarding for a deal that
 * already has one — so a second run changes nothing.
 */

const RESOLUTION_NOTE = 'Verified during post-sale audit — no discrepancies.';

async function run() {
  const leadId = process.argv[2];
  const clean = process.argv.includes('--clean');

  if (!leadId || !Types.ObjectId.isValid(leadId)) {
    console.error(
      'Usage: post-sale-fixture.ts <leadId> [--clean]  (leadId must be an ObjectId)',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);

  const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
  const dealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
  const policyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
  const householdModel = app.get<Model<Household>>(
    getModelToken(Household.name),
  );
  const userModel = app.get<Model<User>>(getModelToken(User.name));
  const templateModel = app.get<Model<AuditTemplate>>(
    getModelToken(AuditTemplate.name),
  );
  const auditModel = app.get<Model<DealAudit>>(getModelToken(DealAudit.name));
  const itemModel = app.get<Model<DealAuditItem>>(
    getModelToken(DealAuditItem.name),
  );
  const onboardingModel = app.get<Model<Onboarding>>(
    getModelToken(Onboarding.name),
  );
  const ticketModel = app.get<Model<ServiceTicket>>(
    getModelToken(ServiceTicket.name),
  );
  const auditGeneration = app.get(AuditGenerationService);
  const dealAudits = app.get(DealAuditsService);
  const serviceTickets = app.get(ServiceTicketsService);

  const lead = await leadModel.findById(leadId);
  if (!lead) {
    console.error(`No lead ${leadId}.`);
    await app.close();
    process.exit(1);
  }

  const deal = await dealModel.findOne({ leadId: lead._id }).sort({ _id: -1 });
  if (!deal) {
    console.error(
      `Lead ${leadId} has no deal — nothing was sold, so there is no post-sale ` +
        'flow to run. Submit the Sold form first.',
    );
    await app.close();
    process.exit(1);
  }

  const agencyId = String(deal.agencyId);
  const branchId = String(deal.branchId ?? '');
  const householdId = deal.householdId ? String(deal.householdId) : null;

  if (clean) {
    // Tickets go before their parent: a chain whose onboarding record is gone
    // is unreachable from every view, so it would leak silently.
    const onboardingIds = (
      await onboardingModel.find({ dealId: deal._id }).select('_id').lean()
    ).map((o) => o._id);
    const tickets = await ticketModel.deleteMany({
      'onboarding.onboardingId': { $in: onboardingIds },
    });
    const onboardings = await onboardingModel.deleteMany({ dealId: deal._id });
    const items = await itemModel.deleteMany({ dealId: deal._id });
    const audits = await auditModel.deleteMany({ dealId: deal._id });
    console.log(
      `\nRemoved ${items.deletedCount} audit items, ${audits.deletedCount} ` +
        `audit records, ${onboardings.deletedCount} onboardings and ` +
        `${tickets.deletedCount} onboarding tickets.\n`,
    );
    await app.close();
    return;
  }

  const producer = deal.producerId
    ? await userModel.findById(deal.producerId)
    : null;
  const producerName = displayName(producer) || 'Unknown producer';
  const household = householdId
    ? await householdModel.findById(householdId)
    : null;
  const policies = await policyModel.find({ dealId: deal._id });

  console.log(`\nPost-sale fixture — ${deal.clientName ?? lead.firstName}\n`);
  console.log(`  lead      ${String(lead._id)} (${lead.status})`);
  console.log(
    `  deal      ${String(deal._id)} — ${deal.dealType}, $${deal.premium}`,
  );
  console.log(`  household ${householdId ?? '—'}`);
  console.log(
    `  policies  ${policies.map((p) => p.policyNumber).join(', ') || '—'}`,
  );

  /* ---------------------------------------------------------------- *
   * 1. The checklist catalog
   *
   * `AuditGenerationService` resolves every computed title against an active
   * template by exact name, so an agency with an empty catalog generates
   * nothing — which is exactly why this deal came out of the Sold form with
   * `auditGenerationStatus: 'no_templates'`.
   * ---------------------------------------------------------------- */
  const seeded = await seedAuditTemplates(templateModel, agencyId, branchId);
  console.log(
    `\n1. Audit templates: ${seeded.created} created, ${seeded.refreshed} refreshed.`,
  );

  /* ---------------------------------------------------------------- *
   * 2. Generate the hand-off checklist for the deal.
   * ---------------------------------------------------------------- */
  const policyIdByType = new Map<string, Types.ObjectId>(
    policies
      .filter((p) => p.policyType)
      .map((p) => [String(p.policyType), p._id]),
  );

  const generated = await auditGeneration.generateForDeal({
    agencyId,
    branchId,
    dealId: deal._id,
    producerId: deal.producerId ?? undefined,
    producerName,
    clientName: deal.clientName,
    submissionToken: deal.submissionToken,
    policyIdByType,
  });
  console.log(
    `2. Audit generation: ${generated.status}, ${generated.itemCount} items` +
      (generated.unresolved.length
        ? ` (no template for: ${generated.unresolved.join(', ')})`
        : ''),
  );
  if (generated.status !== 'generated') {
    console.error('   Stopping — nothing to pass.');
    await app.close();
    process.exit(1);
  }

  /* ---------------------------------------------------------------- *
   * 3. Pass the audit.
   *
   * Through `resolveItem` rather than a bulk update, so each item gets the
   * same stamps and `audit_resolved` activity the hand-off board's button
   * writes. Resolved as the producer who sold the deal — the board is
   * `own`-scoped, and they are the only one who could have cleared these.
   * ---------------------------------------------------------------- */
  const access = producerAccess(agencyId, branchId, deal.producerId);
  const items = await itemModel.find({ dealId: deal._id });
  let resolved = 0;
  for (const item of items) {
    await dealAudits.resolveItem(access, branchId, String(item._id), {
      note: RESOLUTION_NOTE,
    });
    resolved += 1;
  }

  // The parent roll-up. Generation deliberately leaves this `Pending` because
  // nothing has been audited yet; with every item cleared, it is a Pass.
  const passedAt = new Date();
  const audit = await auditModel.findOneAndUpdate(
    { agencyId, dealId: deal._id },
    {
      $set: {
        result: 'Pass',
        auditDate: passedAt,
        auditScore: 100,
        reasonCodes: [],
        auditNotes: `All ${resolved} hand-off items verified. Cleared for onboarding.`,
      },
    },
    { new: true },
  );

  // Generation stamps the deal `Not Submitted`, which is true right up until
  // the last item clears. `Complete` is the vocabulary the migration and demo
  // seed use for a finished audit.
  deal.dealAuditStatus = 'Complete';
  await deal.save();

  console.log(
    `3. Audit passed: ${resolved}/${items.length} items resolved, ` +
      `parent ${audit ? String(audit._id) : '(missing)'} → Pass.`,
  );

  /* ---------------------------------------------------------------- *
   * 4. Hand off to onboarding.
   *
   * One ticket per call, chained — this creates the parent record and the
   * welcome call; completing that one opens the 3-day check-in, and so on.
   * The CSR is whoever the agency assigns; the deal's `crmAssignmentStatus`
   * is `no_pool` here, so fall back to the branch's CSR.
   * ---------------------------------------------------------------- */
  if (!householdId) {
    console.error('4. Onboarding skipped — the deal has no household.');
    await app.close();
    process.exit(1);
  }

  const csr =
    (await userModel.findOne({ email: 'csr@smithfamily.local' })) ?? null;
  const primaryPolicy = policies[0];

  const onboarding = await serviceTickets.startOnboarding({
    agencyId,
    branchId,
    householdId,
    clientName: deal.clientName ?? household?.primaryContactName ?? '',
    salesProducerName: producerName,
    dealId: String(deal._id),
    dealAuditId: audit ? String(audit._id) : null,
    assignedUserId: csr ? String(csr._id) : null,
    startedAt: passedAt,
    policyId: primaryPolicy ? String(primaryPolicy._id) : null,
    policyNumber: primaryPolicy?.policyNumber ?? '',
    policyType: primaryPolicy?.policyType ?? '',
    householdName: household?.name ?? '',
    phone: household?.primaryPhones?.[0] ?? '',
    email: household?.primaryEmails?.[0] ?? '',
    createdByUserId: csr ? String(csr._id) : null,
    createdByName: displayName(csr),
    openingNote: `Deal audit passed ${passedAt.toDateString()} — handed off from ${producerName}.`,
  });

  console.log(
    `4. Onboarding ${onboarding.id} started for ${onboarding.clientName}:`,
  );
  for (const step of onboarding.chain) {
    console.log(
      `     ${step.sequence}. ${step.label.padEnd(22)} ` +
        `${step.ticketId ? String(step.ticketId) : 'not scheduled'}  ` +
        `${step.availableAt ? `opens ${shortDate(step.availableAt)}` : ''}` +
        `${step.dueAt ? ` · due ${shortDate(step.dueAt)}` : ''}`,
    );
  }

  /* ---------------------------------------------------------------- *
   * 5. The household's policy count.
   *
   * Nothing in the sold-deal flow maintains this — lead intake writes 0 and
   * only the migration ever writes anything else — so a household that just
   * bought a policy still reads "0 active policies" on its detail page.
   * Recount from the policies rather than incrementing, so a re-run is
   * still correct.
   * ---------------------------------------------------------------- */
  if (household) {
    const activePolicies = await policyModel.countDocuments({
      householdId: household._id,
      active: true,
    });
    if (household.totalActivePolicies !== activePolicies) {
      household.totalActivePolicies = activePolicies;
      await household.save();
      console.log(`5. Household active policy count → ${activePolicies}.`);
    }
  }

  console.log('');
  await app.close();
}

/**
 * The producer's access, as the guards would have built it. A producer is
 * `own`-scoped, which is what `resolveItem` checks the audit item against.
 */
function producerAccess(
  agencyId: string,
  branchId: string,
  userId?: Types.ObjectId | null,
): AccessContext {
  return {
    userId: String(userId ?? ''),
    agencyId,
    branchId: branchId || null,
    isPlatformAdmin: false,
    scope: AccessScope.Branch,
    dataScope: DataScope.Own,
    permissions: [],
  };
}

function displayName(user: { firstName?: string; lastName?: string } | null) {
  if (!user) return '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ');
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
