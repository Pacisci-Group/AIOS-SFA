import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { LEAD_STATUSES, leadStatusQueryValues } from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import {
  buildAddressKey,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  phonesMatch,
} from './intake.normalize';
import {
  IntakeAddress,
  IntakeInput,
  ResolvedLead,
  sessionOptions,
  StepDeps,
} from './intake.types';

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
 * The insured dwelling to store, with "same as household" already applied.
 *
 * Resolving it here rather than persisting the flag means nothing downstream has
 * to remember the rule — and, as on the Quote Recap, a submission that claims
 * "same as household" cannot smuggle in a different address: its own
 * `propertyAddress` is discarded, not merged.
 */
function resolvePropertyAddress(input: IntakeInput): IntakeAddress | undefined {
  const address = input.sameAsHousehold ? input.address : input.propertyAddress;
  if (!address) return undefined;
  // An address whose every part is blank is noise, not data — the form sends
  // empty strings for a section the submitter never saw. Fields listed rather
  // than `Object.values`, whose `{}` overload widens to `any[]`.
  const hasAny = [
    address.street,
    address.city,
    address.state,
    address.zip,
  ].some((value) => value?.trim());
  return hasAny ? address : undefined;
}

interface LeadRefs {
  contactId: Types.ObjectId;
  householdId: Types.ObjectId;
  /** Already namespaced by channel; null when the client sent none. */
  token: string | null;
}

/** Step 3 — dedupe in strict signal order, then create. */
@Injectable()
export class ResolveLeadStep {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
  ) {}

  async run(
    input: IntakeInput,
    refs: LeadRefs,
    deps: StepDeps,
  ): Promise<ResolvedLead> {
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

    // --- Signal 2: quote control number -----------------------------------
    const qcn = input.quoteControlNumber?.trim();
    if (qcn) {
      const byQcn = await this.leadModel
        .findOne({ agencyId: deps.ctx.agencyId, quoteControlNumber: qcn })
        .session(deps.session);
      if (byQcn) {
        await this.mergeIntoExisting(byQcn, input, refs, deps);
        return { leadId: byQcn._id, isNew: false };
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
      };
      const byAddress = await this.leadModel
        .findOne(filter)
        .sort({ createdAt: -1 })
        .session(deps.session);
      if (byAddress) {
        await this.mergeIntoExisting(byAddress, input, refs, deps);
        return { leadId: byAddress._id, isNew: false };
      }
    }

    return this.create(input, refs, addressKey, deps);
  }

  private async create(
    input: IntakeInput,
    refs: LeadRefs,
    addressKey: string | null,
    deps: StepDeps,
  ): Promise<ResolvedLead> {
    const now = new Date();
    const email = normalizeEmail(input.primaryContact.email);
    const phone = normalizePhone(input.primaryContact.phone);

    const [created] = await this.leadModel.create(
      [
        {
          agencyId: deps.ctx.agencyId,
          branchId: deps.ctx.branchId,
          firstName: normalizeName(input.primaryContact.firstName),
          lastName: normalizeName(input.primaryContact.lastName),
          emails: email ? [email] : [],
          phones: phone ? [phone] : [],
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
          policiesOfInterest: input.policiesOfInterest ?? [],
          propertyAddress: resolvePropertyAddress(input),
          quoteControlNumber: input.quoteControlNumber?.trim() || undefined,
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
  ): Promise<void> {
    const email = normalizeEmail(input.primaryContact.email);
    const phone = normalizePhone(input.primaryContact.phone);

    const addToSet: Record<string, string> = {};
    if (email && !(lead.emails ?? []).map(normalizeEmail).includes(email)) {
      addToSet.emails = email;
    }
    if (
      phone &&
      !(lead.phones ?? [])
        .map(normalizePhone)
        .some((p) => phonesMatch(p, phone))
    ) {
      addToSet.phones = phone;
    }

    // Only fill genuinely empty fields.
    const set: Record<string, unknown> = { lastActivityAt: new Date() };
    if (!lead.householdId) set.householdId = refs.householdId;
    if (!lead.primaryContactId) set.primaryContactId = refs.contactId;
    if (!lead.quoteControlNumber && input.quoteControlNumber?.trim()) {
      set.quoteControlNumber = input.quoteControlNumber.trim();
    }

    // Additive, like the contact details above: someone re-enquiring about a
    // second line wants both quoted, so the union is the honest answer. Merged
    // in code rather than with `$addToSet`, which compares whole sub-documents
    // — "Auto x1" and "Auto x2" are not two interests, they are one restated.
    const incoming = input.policiesOfInterest ?? [];
    if (incoming.length > 0) {
      const merged = [...(lead.policiesOfInterest ?? [])];
      for (const policy of incoming) {
        if (
          !merged.some((existing) => existing.policyType === policy.policyType)
        ) {
          merged.push(policy);
        }
      }
      set.policiesOfInterest = merged;
    }

    const propertyAddress = resolvePropertyAddress(input);
    if (!lead.propertyAddress && propertyAddress) {
      set.propertyAddress = propertyAddress;
    }

    await this.leadModel.updateOne(
      { _id: lead._id },
      {
        $set: set,
        ...(Object.keys(addToSet).length > 0 ? { $addToSet: addToSet } : {}),
      },
      sessionOptions(deps.session),
    );
  }
}
