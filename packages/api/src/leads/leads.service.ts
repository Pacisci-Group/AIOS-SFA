import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  CreateLeadResponse,
  LEAD_SOURCE_NONE,
  PolicyReplacementReason,
  ReplacementLeadLookup,
  ServiceTicketView,
  isPhoneLike,
  leadStatusQueryValues,
  normalizeLeadStatus,
  searchDigits,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { buildScopeFilter } from '../common/access/scope-filter';
import {
  loadContactDetails,
  type ContactDetails,
} from '../contacts/contact-details';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import {
  addressPaths,
  buildSearchFilter,
  phoneDigitsRegex,
  tokenRegex,
} from '../common/mongo/search-filter';
import { LeadTicketsService } from '../crm/lead-tickets.service';
import { LeadSourcesService } from '../lead-sources/lead-sources.service';
import { TenantContextResolver } from '../common/tenancy/tenant-context.resolver';
import { PoliciesService } from '../policies/policies.service';
import { LeadAccessService } from './lead-access.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { LeadIntakeService } from './intake/lead-intake.service';
import { IntakeContext } from './intake/intake.types';
import { LeadListResponse, LeadRow } from './leads.types';
import { Lead, LeadDocument } from './schemas/lead.schema';

/**
 * How many contacts one email/phone term may resolve into an `$in`.
 *
 * Same rule and the same reason as `CHILD_MATCH_CAP` on the Clients page: a
 * very broad term returns the first page of matches rather than building an
 * unbounded `$in`, which is the right trade for a search box nobody uses one
 * character at a time.
 */
const CONTACT_MATCH_CAP = 500;

/**
 * Every lead field the search box looks at.
 *
 * A superset of the rendered columns, which is the rule PAC-101 exists to
 * enforce — plus the identity fields a row does not show but a producer still
 * pastes in. `status` and `temperature` are deliberately absent: both have
 * their own facet, and folding them into free text would make `new` match every
 * lead whose street is "Newton".
 *
 * **Three address roots, because a lead has had three.** `address` is the
 * living address intake writes today; `propertyAddress` is the lead-level one
 * PAC-56 #14 stopped writing but every migrated lead still carries; and
 * `policiesOfInterest[].propertyAddress` is where a dwelling address lives now
 * that one lead can ask about a home *and* a rental. Searching only the first
 * would make a new lead's rental address unfindable — the exact class of bug
 * this ticket is about. Mongo matches a dotted path into an array against any
 * element, so the third needs no `$elemMatch`.
 */
const LEAD_SEARCH_FIELDS = [
  'firstName',
  'lastName',
  'quoteControlNumber',
  ...addressPaths('address'),
  ...addressPaths('propertyAddress'),
  ...addressPaths('policiesOfInterest.propertyAddress'),
] as const;

/**
 * A quote control number, matched against the **whole** term.
 *
 * `QCN-11741` tokenizes to `qcn` + `11741`, and ANDing those is not what a
 * producer who pasted the number meant. Legacy tested `/^[a-z0-9]{8,}$/` for
 * this *first and exclusively*, so an ordinary surname was treated as a control
 * number and a real `QCN-11741` failed the test on its own hyphen. It is one
 * alternative among several now, and it never suppresses the others.
 */
function byQuoteControlNumber(term: string): FilterQuery<LeadDocument> | null {
  const trimmed = term.trim();
  if (trimmed.length < MIN_CONTROL_NUMBER_SEARCH_LENGTH) return null;
  return { quoteControlNumber: tokenRegex(trimmed) };
}

/**
 * Below this, a control-number "match" is noise — every two-character term
 * would drag the whole lead collection into the query for nothing. Mirrors the
 * floors on `MIN_POLICY_NUMBER_KEY_LENGTH` and
 * `MIN_MAILER_CONTROL_NUMBER_KEY_LENGTH`, which exist for the same reason.
 */
const MIN_CONTROL_NUMBER_SEARCH_LENGTH = 4;

/** Lean projection of the fields the list renders. */
type LeadLean = Pick<
  Lead,
  'firstName' | 'lastName' | 'status' | 'temperature' | 'quoteControlNumber'
> & {
  _id: Types.ObjectId;
  leadSourceId?: Types.ObjectId;
  lastActivityAt?: Date;
  primaryContactId?: Types.ObjectId;
};

@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    private readonly tenancy: TenantContextResolver,
    private readonly intake: LeadIntakeService,
    private readonly leadAccess: LeadAccessService,
    private readonly leadTickets: LeadTicketsService,
    /*
     * Cancel Rewrite and Company Transfer create their lead from a policy, and
     * `loadHouseholdPolicy` is the authority on whether the caller may reach it
     * — the household rule, the same clamp the household policy edit uses.
     * Injected rather than reimplemented so the rule exists once.
     */
    private readonly policies: PoliciesService,
    private readonly leadSources: LeadSourcesService,
  ) {}

  /**
   * Create a lead from the authenticated New Lead form (PAC-37).
   *
   * Builds the internal {@link IntakeContext} and hands off — all matching,
   * dedupe, linking and assignment live in {@link LeadIntakeService}, which is
   * shared verbatim with the public share-link route.
   */
  async create(
    access: AccessContext,
    branchId: string | null,
    dto: CreateLeadDto,
  ): Promise<CreateLeadResponse> {
    const ctx = await this.buildInternalContext(access, branchId, dto);

    /*
     * A replacement names a **policy**; the household is derived from it here
     * rather than trusted from the body, so a caller cannot write a replacement
     * lead against a book they do not own. `resolveReplacement` also re-runs the
     * replaceable checks, because the entry point's copy of them is a
     * convenience and this is the enforcement.
     */
    const replacement = dto.replacementIntent
      ? await this.resolveReplacement(access, dto)
      : null;

    const outcome = await this.intake.process(ctx, {
      primaryContact: dto.primaryContact,
      address: dto.address,
      members: dto.members,
      policiesOfInterest: dto.policiesOfInterest,
      quoteControlNumber: dto.quoteControlNumber,
      submissionToken: dto.submissionToken,
      // Set by the Household page's "Start Quote" flow, where the caller already
      // has the household open, and by a replacement, where it is derived from
      // the policy. Absent everywhere else, including the public route, whose
      // schema does not accept it.
      householdId: replacement?.householdId ?? dto.householdId,
      replacementIntent: replacement?.intent,
    });
    return { id: outcome.leadId.toString() };
  }

  /**
   * Check a replacement is allowed, and say which household it belongs to.
   *
   * The guards mirror `PolicyRewritesService.record` exactly, and deliberately:
   * the Sold submit is what finally retires the policy, but discovering there
   * that it cannot be retired would strand a rep who has just filled in two
   * forms. Failing at lead creation is the cheapest honest place.
   *
   * Scope is the **household** rule (`loadHouseholdPolicy`), the same one the
   * household policy edit uses: a replacement is an action on the client's
   * book, and the sales-record clamp would 404 every migrated policy for an
   * `own`-scope producer. Out of scope 404s rather than 403s either way.
   */
  private async resolveReplacement(
    access: AccessContext,
    dto: CreateLeadDto,
  ): Promise<{
    householdId: string;
    intent: { policyId: Types.ObjectId; reason: PolicyReplacementReason };
  }> {
    const requested = dto.replacementIntent;
    if (!requested) {
      throw new BadRequestException('No replacement was requested.');
    }

    const policy = await this.policies.loadHouseholdPolicy(
      access,
      requested.policyId,
    );

    if (!policy.householdId) {
      throw new BadRequestException(
        'This policy is not linked to a household, so a replacement cannot be written for it. Link it first.',
      );
    }
    // Replaced before inactive: a replaced policy is also inactive, and
    // "already replaced" is the message that tells the rep what to do next.
    if (policy.transferredToPolicyId) {
      throw new ConflictException(
        'This policy has already been replaced. Replace its replacement instead.',
      );
    }
    if (!policy.active) {
      throw new ConflictException(
        'This policy is not active, so it cannot be replaced.',
      );
    }

    /*
     * A household sent alongside must agree with the policy's. It is not used —
     * the policy's own household wins — but a disagreement means the client is
     * confused about which client it is looking at, and silently overriding it
     * would write the replacement somewhere the rep is not expecting.
     */
    if (dto.householdId && dto.householdId !== String(policy.householdId)) {
      throw new BadRequestException(
        'That policy belongs to a different household than the one given.',
      );
    }

    return {
      householdId: String(policy.householdId),
      intent: { policyId: policy._id, reason: requested.reason },
    };
  }

  /**
   * Where a replacement should start, for one policy and one reason.
   *
   * The single call both entry points make before routing anywhere. Three
   * answers in one read, because the button needs all three to decide and a
   * second round trip to learn it cannot proceed is a round trip wasted:
   *
   *   - **`blockedReason` set** — this policy cannot be replaced at all. The
   *     same guards {@link resolveReplacement} enforces at lead creation,
   *     reported here so the chain never starts rather than failing after a
   *     form.
   *   - **`leadId` set** — a lead was already created for this and abandoned
   *     before the Sold form. Resume there.
   *   - **both null** — nothing started. Create the lead first.
   *
   * Returned rather than thrown, unlike the guards themselves: the caller is
   * asking *whether* it may act, and an exception is the wrong shape for "no,
   * and here is why".
   *
   * ## Why this lives on the leads side
   *
   * It needs both `loadHouseholdPolicy` (is this policy reachable and replaceable?)
   * and the lead scope rule (is there an open lead I am allowed to resume?).
   * `LeadsModule` imports `PoliciesModule`, so both are available here; putting
   * it on the policies controller would have needed the reverse import too, and
   * that is the cycle.
   */
  async replacementLead(
    access: AccessContext,
    branchId: string | null,
    policyId: string,
    reason: PolicyReplacementReason,
  ): Promise<ReplacementLeadLookup> {
    const policy = await this.policies.loadHouseholdPolicy(access, policyId);

    const householdId = policy.householdId ? String(policy.householdId) : null;

    // Same order as `resolveReplacement`: replaced before inactive.
    const blockedReason = !policy.householdId
      ? 'This policy is not linked to a household, so a replacement cannot be written for it. Link it first.'
      : policy.transferredToPolicyId
        ? 'This policy has already been replaced. Replace its replacement instead.'
        : !policy.active
          ? 'This policy is not active, so it cannot be replaced.'
          : null;

    if (blockedReason) {
      return { leadId: null, householdId, blockedReason };
    }

    const lead = await this.findReplacementLead(
      access,
      branchId,
      policyId,
      reason,
    );

    return {
      leadId: lead ? String(lead._id) : null,
      householdId,
      blockedReason: null,
    };
  }

  /**
   * The open lead already created for this policy's replacement, or null —
   * what makes the two-form chain resumable.
   *
   * A rep can create the lead and close the tab before the Sold form. Asking
   * again for the same action on the same policy must land them on that lead
   * rather than opening a second one beside it, so both entry points ask this
   * first.
   *
   * **Keyed on the intent, not the address**, which is why
   * `ResolveLeadStep`'s address dedupe can be skipped for replacements without
   * giving up duplicate protection where it matters.
   *
   * `reason` is part of the key: a policy could in principle be queued for a
   * rewrite and a transfer, and resuming one into the other would apply the
   * wrong money rules. Newest first, because a second intent for the same pair
   * is not rejected at write time — see the index's note.
   */
  private async findReplacementLead(
    access: AccessContext,
    branchId: string | null,
    policyId: string,
    reason: PolicyReplacementReason,
  ): Promise<LeadDocument | null> {
    const tenant = await this.tenancy.resolve(access, branchId);
    if (!Types.ObjectId.isValid(policyId)) return null;

    const leads = await this.leadModel
      .find({
        agencyId: tenant.agencyId,
        'replacementIntent.policyId': new Types.ObjectId(policyId),
        'replacementIntent.reason': reason,
        // Unconsumed only. A consumed intent explains a lead whose work is
        // already done; resuming into it would book a second replacement.
        'replacementIntent.consumedAt': null,
      })
      .sort({ createdAt: -1 });

    /*
     * Scope is applied *after* the query rather than inside it: `own` scope on a
     * lead is `producerId`, and a rep who abandoned a replacement someone else
     * started should get a fresh lead of their own rather than a 404 on a record
     * they cannot see. `assertOwned` is the authority on that rule and works on
     * the document already in hand — this used to call `loadOwnedLead`, which
     * re-fetched each candidate by id for nothing.
     */
    for (const lead of leads) {
      try {
        this.leadAccess.assertOwned(
          { producerId: lead.producerId, branchId: lead.branchId },
          access,
          branchId,
        );
        return lead;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Open the CRM service ticket for a lead, or return the one it already has —
   * `POST /leads/:id/service-ticket`, called by the Start Quote dialog.
   *
   * Scope is clamped here, by the same `loadOwnedLead` every other lead-scoped
   * write goes through: a producer cannot open a ticket against someone else's
   * lead, and asking 404s rather than 403s. `LeadTicketsService` then does the
   * work without a second permission check, which is why that clamp has to
   * happen on this side of the call.
   */
  async openServiceTicket(
    access: AccessContext,
    branchId: string | null,
    leadId: string,
  ): Promise<ServiceTicketView> {
    const lead = await this.leadAccess.loadOwnedLead(access, branchId, leadId);
    return this.leadTickets.ensureForLead(access, lead);
  }

  /**
   * Tenancy for a lead typed in by a signed-in user.
   *
   * The caller is always the producer, with no role check — `leads:write` is
   * held by Agency Owner and Branch Manager too, so either can end up owning a
   * lead. That mirrors legacy and is an accepted trade-off (PAC-53), not an
   * oversight.
   */
  private async buildInternalContext(
    access: AccessContext,
    branchId: string | null,
    dto: CreateLeadDto,
  ): Promise<IntakeContext> {
    const tenant = await this.tenancy.resolve(access, branchId);
    // The DTO checked the shape; this checks the row is real, active and this
    // agency's to pick — before anything is written.
    const leadSourceId = await this.leadSources.assertSelectable(
      tenant.agencyId,
      dto.leadSourceId,
    );

    return {
      agencyId: tenant.agencyId,
      branchId: tenant.branchId,
      producerId: new Types.ObjectId(access.userId),
      channel: 'internal',
      leadSourceId,
      actorUserId: new Types.ObjectId(access.userId),
    };
  }

  /**
   * The Leads list (PAC-36). Everything — search, filters, sort, pagination — is
   * resolved server-side, so `total` is exact for every combination. (Legacy did
   * part of the work client-side over a fetched window, which made its totals and
   * page arithmetic approximate.)
   */
  async list(
    access: AccessContext,
    branchId: string | null,
    query: ListLeadsDto,
  ): Promise<LeadListResponse> {
    const { page, pageSize } = query;

    const filter = await this.buildFilter(access, branchId, query);

    const total = await this.leadModel.countDocuments(filter);

    const records = await this.leadModel
      .find(filter)
      // `lastActivityAt` is the analogue of legacy's SmartSuite `last_updated`.
      // The Mongoose `updatedAt` is unusable for ordering: the migration stamped
      // every imported lead with the import run time. `_id` is a stable
      // tiebreaker so pagination doesn't shuffle between pages.
      .sort({ lastActivityAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<LeadLean[]>();

    // One batched lookup for the page, not one per row — the lead's own copy of
    // the primary contact's phone and email is gone (PAC-91 §2).
    const [contacts, sourceLabels] = await Promise.all([
      loadContactDetails(
        this.contactModel,
        records.map((record) => record.primaryContactId),
      ),
      // A few dozen rows, resolved in memory rather than `$lookup` per lead.
      this.leadSources.labelsFor(access.agencyId),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items: records.map((record) =>
        this.toRow(record, contacts, sourceLabels),
      ),
    };
  }

  /**
   * Compose the tenancy/scope clamp, the facet filters, and the search.
   *
   * Async since PAC-91: an email or phone term resolves `contacts` first,
   * because the lead no longer carries a copy of either.
   */
  private async buildFilter(
    access: AccessContext,
    branchId: string | null,
    query: ListLeadsDto,
  ): Promise<FilterQuery<LeadDocument>> {
    // Tenancy + data-scope clamp. `scope`/`producerId` are the client's
    // *request*; `buildScopeFilter` only ever lets them narrow.
    const filter: FilterQuery<LeadDocument> = buildScopeFilter<LeadDocument>(
      access,
      branchId,
      { requestedScope: query.scope, producerId: query.producerId },
    );

    if (query.householdId) {
      // The DTO has already shape-checked it, so the cast cannot throw.
      filter.householdId = new Types.ObjectId(query.householdId);
    }

    if (query.status?.length) {
      // Each selected label expands to itself plus any raw SmartSuite code that
      // maps to it, so filtering "Requote" also finds documents storing `arW7O`.
      // Multiple selections are ORed by the single `$in`.
      filter.status = {
        $in: [...new Set(query.status.flatMap(leadStatusQueryValues))],
      };
    }
    if (query.temperature?.length) {
      filter.temperature = { $in: query.temperature };
    }
    if (query.leadSourceId === LEAD_SOURCE_NONE) {
      // Leads that arrived through a public share link carry no source — nobody
      // has said where they came from yet. Producers need to isolate them to
      // correct them, so "no source" is a first-class filter value rather than
      // something you hunt for by eye. `null` matches an absent field too.
      filter.leadSourceId = null;
    } else if (query.leadSourceId) {
      // The DTO has already shape-checked it, so the cast cannot throw.
      filter.leadSourceId = new Types.ObjectId(query.leadSourceId);
    }

    const dateRange = this.buildDateRange(query);
    if (dateRange) {
      // `createdDate` is the source-system creation date; fall back to the
      // Mongoose timestamp for records the migration left without one.
      filter.$and = [
        ...(filter.$and ?? []),
        {
          $or: [
            { createdDate: dateRange },
            { createdDate: null, createdAt: dateRange },
          ],
        },
      ];
    }

    const search = await this.buildSearch(access.agencyId ?? '', query.search);
    if (search) {
      filter.$and = [...(filter.$and ?? []), search];
    }

    return filter;
  }

  /** Inclusive `createdDate` range; `dateTo` covers the whole day. */
  private buildDateRange(
    query: ListLeadsDto,
  ): { $gte?: Date; $lte?: Date } | null {
    if (!query.dateFrom && !query.dateTo) return null;

    const range: { $gte?: Date; $lte?: Date } = {};
    if (query.dateFrom) {
      range.$gte = query.dateFrom;
    }
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setUTCHours(23, 59, 59, 999);
      range.$lte = end;
    }
    return range;
  }

  /**
   * The filter behind the Leads search box.
   *
   * ## What was wrong (PAC-101)
   *
   * This routed by shape and **returned early**: a term containing `@` was
   * searched as an email and nothing else, and a term with seven or more digits
   * as a phone or control number and nothing else. So a producer whose lead had
   * an all-digit quote control number could not find it by name, and an email
   * query could never fall back to anything. Legacy had the same disease in a
   * different place, and the docblock here used to claim it was cured.
   *
   * Every branch is ORed now. Shape decides what a term is *worth trying as*,
   * never what it is *limited to*.
   *
   * ## Why phone and QCN are whole-term branches
   *
   * Tokenizing splits on punctuation, so a pasted `(918) 555-0134` becomes
   * `918`, `555`, `0134` — three tokens, none of them phone-shaped, and no lead
   * field carries all three. Those two are matched against the raw term and
   * ORed around the token clause; see `TermBranchResolver`.
   */
  private buildSearch(
    agencyId: string,
    raw?: string,
  ): Promise<FilterQuery<LeadDocument> | null> {
    return buildSearchFilter<LeadDocument>(raw, {
      fields: LEAD_SEARCH_FIELDS,
      tokenBranches: [
        (token) => this.byContactText(agencyId, token),
        (token) => this.byLeadSourceName(agencyId, token),
      ],
      termBranches: [
        (term) => this.byContactPhone(agencyId, term),
        (term) => Promise.resolve(byQuoteControlNumber(term)),
      ],
    });
  }

  /**
   * Leads whose **lead source** name contains the token — `mailer` finds every
   * mailer lead. Resolved to ids first: the lead holds a reference, not a copy
   * of the name (PAC-135).
   */
  private async byLeadSourceName(
    agencyId: string,
    token: string,
  ): Promise<FilterQuery<LeadDocument> | null> {
    const ids = await this.leadSources.idsMatchingName(
      agencyId,
      tokenRegex(token),
    );
    return ids.length ? { leadSourceId: { $in: ids } } : null;
  }

  /**
   * Leads whose **primary contact's** email or phone contains the token.
   *
   * Not gated on the term containing `@`: a producer searching `rodriguez`
   * should reach `maria.rodriguez@example.com`, and half the addresses in the
   * book are `firstname.lastname@` anyway.
   *
   * ⚠ **`phone` belongs here as well as in the whole-term branch**, and leaving
   * it out was a real bug: a *partial* number found nothing on this list while
   * the same fragment worked on Clients, which has always matched phone
   * per-token. `byContactPhone` below only fires at
   * {@link MIN_PHONE_SEARCH_DIGITS} or more, so `3333` and `222333` never
   * reached `contacts` at all.
   *
   * The two are complementary, not redundant:
   *
   * - **here**, a plain contains against the stored value — which PAC-91
   *   normalised to digits — so any digit run a producer half-remembers hits.
   * - **there**, digits re-interleaved with `\D*`, so a *formatted* query
   *   matches a stored number that was never normalised. Migrated rows still
   *   hold `(918) 808-2556`, and a plain contains on `9188082556` misses those.
   */
  private byContactText(
    agencyId: string,
    token: string,
  ): Promise<FilterQuery<LeadDocument> | null> {
    const contains = tokenRegex(token);
    return this.byPrimaryContact(agencyId, {
      $or: [{ email: contains }, { phone: contains }],
    });
  }

  /**
   * Leads whose **primary contact's** phone matches the whole term, digits
   * only, in whatever format it was stored.
   *
   * Below {@link MIN_PHONE_SEARCH_DIGITS} this resolves to nothing rather than
   * to a broad match: a four-digit run appears inside ZIPs, policy numbers and
   * street numbers alike, so matching on one is noise, not a result.
   */
  private byContactPhone(
    agencyId: string,
    term: string,
  ): Promise<FilterQuery<LeadDocument> | null> {
    if (!isPhoneLike(term)) return Promise.resolve(null);
    return this.byPrimaryContact(agencyId, {
      phone: { $regex: phoneDigitsRegex(searchDigits(term)) },
    });
  }

  /**
   * Leads whose **primary contact** matches an email or phone predicate
   * (PAC-91 §1–§3).
   *
   * The lead used to carry its own `emails` / `phones` copy and this was a
   * regex over those arrays — which is also why the search found nothing for
   * most migrated leads: the copy was empty. Two queries rather than a
   * `$lookup` because the list is a `find()` whose sort is index-served, and
   * `contacts` is reached by `{ agencyId, email }` / `{ agencyId, phone }`
   * (declared on `ContactSchema` for exactly this).
   *
   * Capped for the same reason the Clients page caps its child resolution: a
   * broad term must not build an unbounded `$in`. A lead with no
   * `primaryContactId` is unreachable this way — as it was before, since its
   * copy was empty too.
   *
   * `null`, not an empty `$in`, when nothing matches: as one branch of an `$or`
   * an unsatisfiable clause is dead weight the planner still has to carry.
   */
  private async byPrimaryContact(
    agencyId: string,
    predicate: FilterQuery<ContactDocument>,
  ): Promise<FilterQuery<LeadDocument> | null> {
    const contacts = await this.contactModel
      .find({ agencyId, ...predicate })
      .select('_id')
      .limit(CONTACT_MATCH_CAP)
      .lean<Array<{ _id: Types.ObjectId }>>();

    if (!contacts.length) return null;
    return {
      primaryContactId: { $in: contacts.map((contact) => contact._id) },
    };
  }

  /**
   * Map a stored document to the display-ready row DTO.
   *
   * `contacts` is the primary-contact details resolved for this page — the lead
   * carries no email or phone of its own any more (PAC-91 §2). A lead with no
   * primary contact shows blanks, which is the honest rendering of a record
   * nobody has linked yet; before PAC-91 *most* migrated leads showed blanks
   * because the copy the list read was never filled.
   */
  private toRow(
    record: LeadLean,
    contacts: Map<string, ContactDetails>,
    sourceLabels: Map<string, string>,
  ): LeadRow {
    const name = [record.firstName, record.lastName]
      .filter((part) => Boolean(part?.trim()))
      .join(' ')
      .trim();

    const source = LeadSourcesService.toRef(record.leadSourceId, sourceLabels);
    const contact = record.primaryContactId
      ? contacts.get(record.primaryContactId.toString())
      : undefined;

    return {
      id: record._id.toString(),
      name: name || 'Unknown Lead',
      // `Unknown` is what this column has always shown for a lead nobody has
      // attributed yet.
      leadSource: source.label || 'Unknown',
      status: normalizeLeadStatus(record.status),
      temperature: record.temperature ?? 'Unknown',
      phone: contact?.phone ?? null,
      email: contact?.email ?? null,
      updatedAt: record.lastActivityAt?.toISOString() ?? null,
    };
  }
}
