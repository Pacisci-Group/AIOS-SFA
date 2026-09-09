import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  LEAD_STATUSES,
  leadStatusQueryValues,
  resolveItemCount,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { normalizeStoredAddress } from '../../common/address/household-address';
import { resolvePolicyPropertyAddress } from '../../common/address/policy-property-address';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import type { LeadPolicyOfInterest } from '../schemas/lead.schema';
import { buildAddressKey, normalizeName } from './intake.normalize';
import {
  IntakeInput,
  ResolvedLead,
  sessionOptions,
  StepDeps,
} from './intake.types';
import {
  MailerLinkResolver,
  type ResolvedMailerLink,
} from './mailer-link.resolver';

/** A new lead starts here — `LEAD_STATUSES[0]`. */
const INITIAL_STATUS = LEAD_STATUSES[0];

/** Per `lead-temperature.ts`: "a new lead starts Hot". */
const INITIAL_TEMPERATURE = 'Hot';

/**
 * Address dedupe only looks back this far. An address matching a lead from three
 * years ago is a new opportunity, not the same one — resurrecting the dead lead
 * would bury the new enquiry under stale status and history.
 */
const ADDRESS_DEDUPE_WINDOW_DAYS = 90;

/**
 * Statuses that end a lead's life. A new enquiry at an address whose previous
 * lead was Sold or Lost must start fresh.
 *
 * Expanded through `leadStatusQueryValues` because the migration wrote raw
 * SmartSuite choice codes: a "Lost" lead may be stored as `jp76g`, so matching
 * on the label alone would silently miss every migrated record.
 */
const TERMINAL_STATUSES = [
  'Sold',
  'Converted',
  'Lost',
  'Closed',
  'Not Qualified',
];
const TERMINAL_STATUS_VALUES = TERMINAL_STATUSES.flatMap(leadStatusQueryValues);

/**
 * The policy rows to store, each with its own dwelling address and
 * "same as household" already applied (PAC-56 #14).
 *
 * Resolving here rather than persisting the flag alone means nothing downstream
 * has to remember the rule — and a row that claims "same as household" cannot
 * smuggle in a different address: its own `propertyAddress` is discarded, not
 * merged. Non-property rows get no address at all, which is load-bearing:
 * `sameAsHousehold` defaults to TRUE, so without that guard an Auto-only lead
 * would silently acquire a copy of the living address.
 */
function resolvePolicies(input: IntakeInput): LeadPolicyOfInterest[] {
  const householdAddress = normalizeStoredAddress(input.address);

  return (input.policiesOfInterest ?? []).map((policy) => {
    const propertyAddress = resolvePolicyPropertyAddress(
      policy,
      householdAddress,
    );
    return {
      policyType: policy.policyType,
      // Never taken straight off the wire — the public form posts here too.
      itemCount: resolveItemCount(policy.policyType, policy.itemCount),
      propertyAddress,
      // Only meaningful where an address exists — a non-property row is not
      // "same as household", it simply has no dwelling.
      sameAsHousehold:
        Boolean(propertyAddress) && policy.sameAsHousehold !== false,
    };
  });
}

/**
 * Identity of a policy row for merge purposes.
 *
 * Type alone is not enough once addresses are per-row: a household adding a
 * second Landlord policy on a different building is stating a second interest,
 * not restating the first. The address is folded into the key so those stay
 * distinct while "Home ×1" and "Home ×2" at one address still collapse.
 */
function policyKey(policy: {
  policyType: string;
  propertyAddress?: { street?: string; city?: string; zip?: string };
}): string {
  const address = policy.propertyAddress;
  const where = [address?.street, address?.city, address?.zip]
    .map((part) => (part ?? '').trim().toUpperCase())
    .join('|');
  return `${policy.policyType}::${where}`;
}

interface LeadRefs {
  contactId: Types.ObjectId;
  householdId: Types.ObjectId;
  /** Already namespaced by channel; null when the client sent none. */
  token: string | null;
  /**
   * True when the caller named {@link householdId} rather than the pipeline
   * deriving it — see `IntakeInput.householdId`.
   *
   * It confines the address dedupe (signal 3) to that household. Without it,
   * "start a quote for the Rivera household" could return a lead belonging to
   * whoever else lives at that street and zip — two households at one address
   * is exactly the case address matching is documented as unable to tell apart.
   */
  householdPinned: boolean;
}

/** Step 3 — dedupe in strict signal order, then create. */
@Injectable()
export class ResolveLeadStep {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    private readonly mailerLinks: MailerLinkResolver,
  ) {}

  async run(
    input: IntakeInput,
    refs: LeadRefs,
    deps: StepDeps,
  ): Promise<ResolvedLead> {
    // Resolve the mailer before deduping: signal 2 keys on it, and `create`
    // stores it. The drawer supplies its own already-certain link; every other
    // caller only has the printed string a submitter typed.
    const link = await this.resolveMailerLink(input, deps);

    // --- Signal 1: submission token (strongest) ---------------------------
    // A hit returns immediately with NO update. A replay is a pure no-op: the
    // caller is re-sending a request we already fully processed, and merging
    // their payload again could only overwrite whatever happened since.
    if (refs.token) {
      const byToken = await this.leadModel
        .findOne({ agencyId: deps.ctx.agencyId, submissionToken: refs.token })
        .session(deps.session);
      if (byToken) return { leadId: byToken._id, isNew: false };
    }

    // --- Signal 2: the mailer, or its control-number key -------------------
    //
    // Keyed on the resolved link rather than on the raw `quoteControlNumber`
    // string it used to compare. Both printed forms of one control number are
    // different strings, and a hand-typed one is stored unnormalized, so string
    // equality missed the very cases this signal exists for. After the PAC-71
    // backfill every lead carrying a control number also carries its key.
    if (link) {
      const byMailer = await this.leadModel
        .findOne(
          link.mailerId
            ? { agencyId: deps.ctx.agencyId, 'mailer.mailerId': link.mailerId }
            : {
                agencyId: deps.ctx.agencyId,
                'mailer.controlNumberKey': link.key,
                // Only an *unlinked* lead: one already bound to a mailer was
                // matched by the branch above, or belongs to a different mailer
                // whose key merely normalizes the same way.
                'mailer.mailerId': null,
              },
        )
        .session(deps.session);
      if (byMailer) {
        await this.mergeIntoExisting(byMailer, input, refs, deps, link);
        return { leadId: byMailer._id, isNew: false };
      }
    }

    // --- Signal 3: address + zip ------------------------------------------
    const addressKey = buildAddressKey(
      input.address?.street,
      input.address?.zip,
    );
    if (addressKey) {
      const cutoff = new Date(
        Date.now() - ADDRESS_DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );
      // Exact equality on the derived key, not legacy's `contains` on the raw
      // street: `contains("12 Main St")` also matched "112 Main St", and the zip
      // half was a substring test against the stringified address object, where
      // a 5-digit zip could match a house number.
      const filter: FilterQuery<LeadDocument> = {
        agencyId: deps.ctx.agencyId,
        addressKey,
        isTestRecord: { $ne: true },
        status: { $nin: TERMINAL_STATUS_VALUES },
        createdAt: { $gte: cutoff },
        // See `LeadRefs.householdPinned`.
        ...(refs.householdPinned ? { householdId: refs.householdId } : {}),
      };
      const byAddress = await this.leadModel
        .findOne(filter)
        .sort({ createdAt: -1 })
        .session(deps.session);
      if (byAddress) {
        await this.mergeIntoExisting(byAddress, input, refs, deps, link);
        return { leadId: byAddress._id, isNew: false };
      }
    }

    return this.create(input, refs, addressKey, deps, link);
  }

  /**
   * The mailer this submission points at, if any.
   *
   * The drawer hands over a certain link; anything else gets one derived from
   * the typed control number, which may resolve to a mailer, to a key alone, or
   * to nothing at all. Never throws — see `MailerLinkResolver`.
   */
  private async resolveMailerLink(
    input: IntakeInput,
    deps: StepDeps,
  ): Promise<ResolvedMailerLink | null> {
    if (input.mailer) {
      return {
        mailerId: input.mailer.mailerId,
        campaignId: input.mailer.campaignId,
        key: input.mailer.controlNumberKey,
      };
    }
    const qcn = input.quoteControlNumber?.trim();
    if (!qcn) return null;
    return this.mailerLinks.resolve(qcn, deps.ctx.agencyId);
  }

  private async create(
    input: IntakeInput,
    refs: LeadRefs,
    addressKey: string | null,
    deps: StepDeps,
    link: ResolvedMailerLink | null,
  ): Promise<ResolvedLead> {
    const now = new Date();

    const [created] = await this.leadModel.create(
      [
        {
          agencyId: deps.ctx.agencyId,
          branchId: deps.ctx.branchId,
          firstName: normalizeName(input.primaryContact.firstName),
          lastName: normalizeName(input.primaryContact.lastName),
          status: INITIAL_STATUS,
          temperature: INITIAL_TEMPERATURE,
          // Null on the public path — stored as the schema default
          // `{ code: null, label: '' }`. `normalizeLeadSource` turns that into
          // the label "Unknown" on read, and it is what the Leads-page
          // "No source" filter matches.
          leadSource: deps.ctx.leadSource ?? { code: null, label: '' },
          agingDays: 0,
          createdDate: now,
          // REQUIRED: `GET /leads` sorts on `lastActivityAt` (updatedAt is
          // unusable — the migration stamped every record with the import time).
          // Without this the lead sinks to the bottom of its own list.
          lastActivityAt: now,
          policiesOfInterest: resolvePolicies(input),
          // `propertyAddress` is deliberately not set: since PAC-56 #14 the
          // dwelling belongs to the policy row, and the lead-level field exists
          // only for migrated SmartSuite records.
          quoteControlNumber: input.quoteControlNumber?.trim() || undefined,
          mailer: buildMailerLink(input, link, deps),
          producerId: deps.ctx.producerId,
          householdId: refs.householdId,
          primaryContactId: refs.contactId,
          submissionToken: refs.token ?? undefined,
          address: input.address,
          addressKey: addressKey ?? undefined,
          intakeSource: {
            channel: deps.ctx.channel,
            shareLinkId: deps.ctx.shareLinkId,
            submittedAt: now,
          },
          // Always false — never computed from the shared `isTestRecord()`
          // helper, which flags any name containing "test"/"sample"/"demo" and
          // would make a real prospect named Demopoulos invisible on every read
          // path, with no feedback to the producer. `Test` is excluded from the
          // selectable sources instead.
          isTestRecord: false,
        },
      ],
      sessionOptions(deps.session),
    );

    deps.created.track(this.leadModel, created._id);
    return { leadId: created._id, isNew: true };
  }

  /**
   * Additive merge onto a deduped lead (signals 2 and 3 only).
   *
   * Adds contact details and refreshes activity, but never touches
   * `producerId`, `status` or `temperature` — those represent work someone has
   * done on the lead, and a fresh form submission is not grounds to undo it.
   */
  private async mergeIntoExisting(
    lead: LeadDocument,
    input: IntakeInput,
    refs: LeadRefs,
    deps: StepDeps,
    link: ResolvedMailerLink | null,
  ): Promise<void> {
    /*
     * No contact details are merged onto the lead any more (PAC-91 §1–§3): it
     * carries no copy of them. A submitted value that disagrees with the stored
     * contact is handled once, in `ResolveContactStep`, which reports it on the
     * timeline instead of recording a second identity.
     */

    // Only fill genuinely empty fields.
    const set: Record<string, unknown> = { lastActivityAt: new Date() };
    if (!lead.householdId) set.householdId = refs.householdId;
    if (!lead.primaryContactId) set.primaryContactId = refs.contactId;
    if (!lead.quoteControlNumber && input.quoteControlNumber?.trim()) {
      set.quoteControlNumber = input.quoteControlNumber.trim();
    }
    // Fill-if-empty, the same rule as the control number above. ⚠ A lead already
    // linked to a *different* mailer keeps that link and the new one goes
    // unrecorded — the address dedupe can land a second mailer's submission on
    // an existing lead, and silently repointing attribution would rewrite which
    // campaign produced it. The caller still learns the lead already existed
    // through `alreadyExisted`.
    if (!lead.mailer?.mailerId && !lead.mailer?.controlNumberKey) {
      const mailer = buildMailerLink(input, link, deps);
      if (mailer) set.mailer = mailer;
    }

    // Additive: someone re-enquiring about a second line wants both quoted, so
    // the union is the honest answer — a policy of interest is a request, not
    // an identity, which is why it merges where a contact detail no longer
    // does (PAC-91 §1). Merged
    // in code rather than with `$addToSet`, which compares whole sub-documents
    // — "Auto x1" and "Auto x2" are not two interests, they are one restated.
    // See {@link policyKey} for why the dwelling is part of that identity.
    const incoming = resolvePolicies(input);
    if (incoming.length > 0) {
      const merged = [...(lead.policiesOfInterest ?? [])];
      const seen = new Set(merged.map(policyKey));
      for (const policy of incoming) {
        const key = policyKey(policy);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(policy);
      }
      set.policiesOfInterest = merged;
    }

    await this.leadModel.updateOne(
      { _id: lead._id },
      { $set: set },
      sessionOptions(deps.session),
    );
  }
}

/**
 * The `Lead.mailer` sub-document to store, or `undefined` when there is nothing
 * worth storing.
 *
 * `matchedBy` records **how the link was made**, never a flattering guess:
 * `drawer` only when the caller resolved the mailer itself, `control_number`
 * when we resolved a typed string to exactly one mailer. A key with no mailer
 * gets no `matchedBy` at all — nothing has been matched yet, and the campaign
 * commit's reconcile step is what fills it in.
 */
function buildMailerLink(
  input: IntakeInput,
  link: ResolvedMailerLink | null,
  deps: StepDeps,
): Record<string, unknown> | undefined {
  if (!link) return undefined;
  return {
    mailerId: link.mailerId,
    campaignId: link.campaignId,
    controlNumberKey: link.key,
    ...(link.mailerId
      ? {
          matchedBy: input.mailer ? input.mailer.matchedBy : 'control_number',
          linkedAt: new Date(),
        }
      : {}),
    linkedBy: deps.ctx.actorUserId,
  };
}
