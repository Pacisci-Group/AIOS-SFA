import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  compareRuleCarriers,
  normalizeLeadSourceRules,
  normalizeRateRules,
  PAYMENT_STRUCTURE_NAME_TAKEN,
  PAYMENT_STRUCTURE_STALE,
  sortBonusTiers,
  type AccessContext,
  type LeadSourceRateRule,
  type LeadSourceRateRuleView,
  type PaymentStructureMemberView,
  type PaymentStructureSummary,
  type PaymentStructureView,
  type PaymentStructuresResponse,
  type PayoutPeopleResponse,
} from '@sfa/shared';
import { Types, type ClientSession, type Model } from 'mongoose';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import { isDuplicateKeyError } from '../common/mongo/duplicate-key';
import {
  TransactionRunner,
  type CreatedRegistry,
} from '../common/mongo/transaction.runner';
import { LeadSourcesService } from '../lead-sources/lead-sources.service';
import { UserRole } from '../permissions/schemas/user-role.schema';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import type {
  UpdatePaymentStructureDto,
  UpsertPaymentStructureDto,
} from './dto/payouts.dto';
import {
  loadPayoutPeople,
  type PayoutPeopleModels,
  type PayoutPerson,
} from './payout-people';
import {
  PaymentStructure,
  PaymentStructureDocument,
  paymentStructureNameKey,
} from './schemas/payment-structure.schema';

type LeanStructure = PaymentStructure & { _id: Types.ObjectId };

/** A save's member list, checked, with the people it names already loaded. */
interface CheckedMembers {
  ids: Types.ObjectId[];
  people: Map<string, PayoutPerson>;
}

/** The agency an admin request acts for; a platform admin outside one has none. */
export function agencyOf(access: AccessContext): string {
  if (!access.agencyId) {
    throw new ForbiddenException('Agency context required');
  }
  return access.agencyId;
}

function sessionOptions(session: ClientSession | null) {
  return session ? { session } : {};
}

function memberView(person: PayoutPerson): PaymentStructureMemberView {
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    roles: person.roles,
    status: person.status,
  };
}

/**
 * A structure's lead-source rules with their sources' names (`labels` is
 * `LeadSourcesService.labelsFor`, archived sources included), by name, then
 * carrier with "any carrier" last. Null-guarded: `.lean()` does not fill the
 * schema default on a document saved before the field existed.
 */
function leadSourceRuleViews(
  doc: LeanStructure,
  labels: ReadonlyMap<string, string>,
): LeadSourceRateRuleView[] {
  return (doc.leadSourceRules ?? [])
    .map((rule) => {
      const leadSourceId = String(rule.leadSourceId);
      return {
        leadSourceId,
        leadSourceName: labels.get(leadSourceId) ?? '',
        carrier: rule.carrier,
        ratePercent: rule.ratePercent,
      };
    })
    .sort(
      (a, b) =>
        a.leadSourceName.localeCompare(b.leadSourceName) ||
        a.leadSourceId.localeCompare(b.leadSourceId) ||
        compareRuleCarriers(a.carrier, b.carrier),
    );
}

function summaryOf(
  doc: LeanStructure,
  memberCount: number,
  labels: ReadonlyMap<string, string>,
): PaymentStructureSummary {
  return {
    id: String(doc._id),
    name: doc.name,
    status: doc.status,
    rules: doc.rules.map((rule) => ({
      carrier: rule.carrier,
      ratePercent: rule.ratePercent,
      // Null-guarded like the fields below: a rule saved before it existed.
      minBundleRatePercent: rule.minBundleRatePercent ?? null,
    })),
    leadSourceRules: leadSourceRuleViews(doc, labels),
    hatTrick: {
      enabled: doc.hatTrick.enabled,
      dealsPerDay: doc.hatTrick.dealsPerDay,
      bonusAmount: doc.hatTrick.bonusAmount,
    },
    individualTiers: doc.individualTiers.map((tier) => ({
      thresholdPremium: tier.thresholdPremium,
      bonusAmount: tier.bonusAmount,
    })),
    tiersStackable: doc.tiersStackable ?? false,
    teamBonusEligible: doc.teamBonusEligible,
    memberCount,
    createdAt: (doc.createdAt ?? new Date(0)).toISOString(),
    updatedAt: (doc.updatedAt ?? new Date(0)).toISOString(),
  };
}

/**
 * Payment structures (PAC-177): the owner's list, the structure wizard's
 * reads and writes, and the people step.
 *
 * Every method is agency-wide: a structure belongs to the agency, and the
 * controller gates all of it on `agency:payouts:admin`.
 *
 * Lead-source rates name their source by id only; every response resolves
 * the names through one `LeadSourcesService.labelsFor` read, never a
 * `$lookup` and never a stored copy (AGENTS.md, PAC-135).
 */
@Injectable()
export class PaymentStructuresService {
  private readonly people: PayoutPeopleModels;

  constructor(
    @InjectModel(PaymentStructure.name)
    private readonly structureModel: Model<PaymentStructureDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    @InjectModel(User.name) userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name) roleModel: Model<AgencyRoleDocument>,
    @InjectModel(UserRole.name) userRoleModel: Model<UserRole>,
    @InjectModel(Branch.name) branchModel: Model<BranchDocument>,
    private readonly transactions: TransactionRunner,
    private readonly leadSources: LeadSourcesService,
  ) {
    this.people = { userModel, roleModel, userRoleModel, branchModel };
  }

  /** Active structures by name, each with its count of people not removed. */
  async list(access: AccessContext): Promise<PaymentStructuresResponse> {
    const agencyId = agencyOf(access);
    const [docs, labels] = await Promise.all([
      this.structureModel
        .find({ agencyId, status: 'active' })
        .sort({ name: 1 })
        .lean<LeanStructure[]>(),
      this.leadSources.labelsFor(agencyId),
    ]);
    const memberIds = docs.flatMap((doc) => doc.memberIds);
    const people = await loadPayoutPeople(this.people, agencyId, memberIds);
    return {
      structures: docs.map((doc) =>
        summaryOf(doc, this.countCurrent(doc.memberIds, people), labels),
      ),
    };
  }

  async detail(
    access: AccessContext,
    id: string,
  ): Promise<PaymentStructureView> {
    const agencyId = agencyOf(access);
    const [doc, labels] = await Promise.all([
      this.find(agencyId, id),
      this.leadSources.labelsFor(agencyId),
    ]);
    const people = await loadPayoutPeople(this.people, agencyId, doc.memberIds);
    return this.view(doc, people, labels);
  }

  /**
   * Everyone who can be put on a structure, with the active structure each
   * person is on today — what lets the people step say "moves from …"
   * before anything is saved.
   */
  async peopleOptions(access: AccessContext): Promise<PayoutPeopleResponse> {
    const agencyId = agencyOf(access);
    const [people, structures] = await Promise.all([
      loadPayoutPeople(this.people, agencyId),
      this.structureModel
        .find({ agencyId, status: 'active' })
        .select('name memberIds')
        .lean<Pick<LeanStructure, '_id' | 'name' | 'memberIds'>[]>(),
    ]);
    const structureOf = new Map<string, { id: string; name: string }>();
    for (const structure of structures) {
      for (const memberId of structure.memberIds) {
        structureOf.set(String(memberId), {
          id: String(structure._id),
          name: structure.name,
        });
      }
    }
    return {
      people: [...people.values()].map((person) => ({
        ...memberView(person),
        branchName: person.branchName,
        structure: structureOf.get(person.id) ?? null,
      })),
    };
  }

  async create(
    access: AccessContext,
    dto: UpsertPaymentStructureDto,
  ): Promise<PaymentStructureView> {
    const agencyId = agencyOf(access);
    const nameKey = paymentStructureNameKey(dto.name);
    await this.assertNameFree(agencyId, nameKey, null);
    await this.assertLeadSources(agencyId, dto.leadSourceRules, []);
    const [members, labels] = await Promise.all([
      this.checkedMembers(agencyId, dto.memberIds, []),
      this.leadSources.labelsFor(agencyId),
    ]);

    const created = await this.write(async (session, registry) => {
      await this.lockStructures(agencyId, session);
      const [doc] = await this.structureModel.create(
        [
          {
            agencyId,
            ...this.fields(dto, nameKey),
            memberIds: members.ids,
            status: 'active',
          },
        ],
        sessionOptions(session),
      );
      registry.track(this.structureModel, doc._id);
      await this.moveMembersHere(agencyId, doc._id, members.ids, session);
      return doc.toObject();
    });
    return this.view(created, members.people, labels);
  }

  /**
   * The whole structure, replaced. Members it gains leave their old
   * structure.
   *
   * Optimistic concurrency: the write only lands on the version the editor
   * loaded (`expectedUpdatedAt`). Anything that saved the structure since —
   * another tab, another admin, or a save of *another* structure that moved
   * one of its members off it (`moveMembersHere` bumps `updatedAt` too) — is
   * a 409 `PAYMENT_STRUCTURE_STALE` rather than a silent overwrite.
   */
  async update(
    access: AccessContext,
    id: string,
    dto: UpdatePaymentStructureDto,
  ): Promise<PaymentStructureView> {
    const agencyId = agencyOf(access);
    const current = await this.find(agencyId, id);
    // Checked up front so a stale page hears so before anything else; the
    // write's filter is what holds under a race.
    this.assertEditable(current, dto.expectedUpdatedAt);
    const nameKey = paymentStructureNameKey(dto.name);
    await this.assertNameFree(agencyId, nameKey, current._id);
    await this.assertLeadSources(
      agencyId,
      dto.leadSourceRules,
      current.leadSourceRules ?? [],
    );
    const [members, labels] = await Promise.all([
      this.checkedMembers(agencyId, dto.memberIds, current.memberIds),
      this.leadSources.labelsFor(agencyId),
    ]);
    const expectedUpdatedAt = new Date(dto.expectedUpdatedAt);

    const updated = await this.write(async (session) => {
      await this.lockStructures(agencyId, session);
      const doc = await this.structureModel
        .findOneAndUpdate(
          {
            _id: current._id,
            agencyId,
            status: 'active',
            updatedAt: expectedUpdatedAt,
          },
          { $set: { ...this.fields(dto, nameKey), memberIds: members.ids } },
          { ...sessionOptions(session), new: true, runValidators: true },
        )
        .lean<LeanStructure>();
      if (!doc) {
        // Archived or saved elsewhere since the read above: say which.
        const now = await this.structureModel
          .findOne(
            { _id: current._id, agencyId },
            null,
            sessionOptions(session),
          )
          .lean<LeanStructure>();
        if (!now) throw new NotFoundException('Payment structure not found');
        this.assertEditable(now, dto.expectedUpdatedAt);
        this.stale();
      }
      await this.moveMembersHere(agencyId, current._id, members.ids, session);
      return doc;
    });
    return this.view(updated, members.people, labels);
  }

  /**
   * Retire a structure. Its members are released — free to join another —
   * and the document stays as history. Archiving twice is a 409, so a stale
   * page cannot report a success that did nothing.
   *
   * One atomic single-document write, so it takes no transaction and no
   * agency lock: emptying a member list can never put anyone on two
   * structures.
   */
  async archive(
    access: AccessContext,
    id: string,
  ): Promise<PaymentStructureSummary> {
    const agencyId = agencyOf(access);
    const current = await this.find(agencyId, id);
    const archived = await this.structureModel
      .findOneAndUpdate(
        { _id: current._id, agencyId, status: 'active' },
        {
          $set: {
            status: 'archived',
            archivedAt: new Date(),
            archivedBy: new Types.ObjectId(access.userId),
            memberIds: [],
          },
        },
        { new: true },
      )
      .lean<LeanStructure>();
    if (!archived) {
      throw new ConflictException('This structure is already archived.');
    }
    return summaryOf(archived, 0, await this.leadSources.labelsFor(agencyId));
  }

  // --- internals -------------------------------------------------------------

  private fields(dto: UpsertPaymentStructureDto, nameKey: string) {
    return {
      name: dto.name.trim().replace(/\s+/g, ' '),
      nameKey,
      rules: normalizeRateRules(dto.rules),
      leadSourceRules: normalizeLeadSourceRules(dto.leadSourceRules).map(
        (rule) => ({
          ...rule,
          leadSourceId: new Types.ObjectId(rule.leadSourceId),
        }),
      ),
      hatTrick: dto.hatTrick,
      individualTiers: sortBonusTiers(dto.individualTiers),
      tiersStackable: dto.tiersStackable,
      teamBonusEligible: dto.teamBonusEligible,
    };
  }

  private async find(agencyId: string, id: string): Promise<LeanStructure> {
    const doc = Types.ObjectId.isValid(id)
      ? await this.structureModel
          .findOne({ _id: new Types.ObjectId(id), agencyId })
          .lean<LeanStructure>()
      : null;
    if (!doc) throw new NotFoundException('Payment structure not found');
    return doc;
  }

  /**
   * The structure with its members, from people (and lead-source names) the
   * caller already loaded.
   */
  private view(
    doc: LeanStructure,
    people: Map<string, PayoutPerson>,
    labels: ReadonlyMap<string, string>,
  ): PaymentStructureView {
    const members = doc.memberIds
      .map((memberId) => people.get(String(memberId)))
      .filter((person): person is PayoutPerson => Boolean(person))
      .map(memberView)
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      ...summaryOf(doc, this.countCurrent(doc.memberIds, people), labels),
      members,
    };
  }

  /** Members who have not been removed from the agency. */
  private countCurrent(
    memberIds: readonly Types.ObjectId[],
    people: Map<string, PayoutPerson>,
  ): number {
    return memberIds.filter((id) => {
      const person = people.get(String(id));
      return person !== undefined && person.status !== 'deactivated';
    }).length;
  }

  private async assertNameFree(
    agencyId: string,
    nameKey: string,
    except: Types.ObjectId | null,
  ): Promise<void> {
    const clash = await this.structureModel.exists({
      agencyId,
      status: 'active',
      nameKey,
      ...(except ? { _id: { $ne: except } } : {}),
    });
    if (clash) this.nameTaken();
  }

  private nameTaken(): never {
    throw new ConflictException({
      code: PAYMENT_STRUCTURE_NAME_TAKEN,
      message: 'Another payment structure already has this name.',
    });
  }

  /** 409 unless `doc` is active and still the version the editor loaded. */
  private assertEditable(doc: LeanStructure, expectedUpdatedAt: string): void {
    if (doc.status !== 'active') {
      throw new ConflictException('This structure is archived.');
    }
    const stored = (doc.updatedAt ?? new Date(0)).getTime();
    if (stored !== new Date(expectedUpdatedAt).getTime()) this.stale();
  }

  private stale(): never {
    throw new ConflictException({
      code: PAYMENT_STRUCTURE_STALE,
      message:
        'This structure was changed somewhere else. Reload to see the latest version.',
    });
  }

  /**
   * The member list a save may store: the agency's own people, never a
   * platform admin, deduplicated. Someone removed from the agency may
   * **stay** on a structure they were already on (their last month is still
   * paid from it) but cannot be added to one.
   *
   * Returns the people it loaded too, so the save's response is built from
   * them rather than from a second read.
   */
  private async checkedMembers(
    agencyId: string,
    requested: readonly string[],
    current: readonly Types.ObjectId[],
  ): Promise<CheckedMembers> {
    const ids = [...new Set(requested)];
    if (!ids.length) return { ids: [], people: new Map() };
    const people = await loadPayoutPeople(this.people, agencyId, ids);
    const missing = ids.filter((id) => !people.has(id));
    if (missing.length) {
      throw new BadRequestException(
        'Some of the people chosen are not in this agency.',
      );
    }
    const already = new Set(current.map(String));
    const removed = ids
      .map((id) => people.get(id)!)
      .filter(
        (person) => person.status === 'deactivated' && !already.has(person.id),
      );
    if (removed.length) {
      throw new BadRequestException(
        `${removed.map((person) => person.name).join(', ')} ${
          removed.length === 1 ? 'has' : 'have'
        } been removed from the agency and cannot be added.`,
      );
    }
    return { ids: ids.map((id) => new Types.ObjectId(id)), people };
  }

  /**
   * The lead sources a save's rules may name: rows this agency can see — its
   * own or the platform's; anything else (another agency's, or no row at
   * all) is a 400. A source archived after it was chosen may **stay** on a
   * structure whose rules already name it — the members rule again — but
   * cannot be added, as `LeadSourcesService.assertSelectable` refuses an
   * archived pick everywhere else.
   */
  private async assertLeadSources(
    agencyId: string,
    rules: readonly LeadSourceRateRule[],
    current: readonly { leadSourceId: Types.ObjectId }[],
  ): Promise<void> {
    const ids = [
      ...new Set(rules.map((rule) => rule.leadSourceId.toLowerCase())),
    ];
    if (!ids.length) return;
    const rows = await this.leadSources.visibleRows(agencyId, ids);
    if (ids.some((id) => !rows.has(id))) {
      throw new BadRequestException(
        'Some lead sources chosen are not available to this agency.',
      );
    }
    const already = new Set(current.map((rule) => String(rule.leadSourceId)));
    const archived = ids
      .filter((id) => !rows.get(id)!.active && !already.has(id))
      .map((id) => rows.get(id)!.name);
    if (archived.length) {
      throw new BadRequestException(
        `${archived.join(', ')} ${
          archived.length === 1 ? 'has' : 'have'
        } been archived and cannot be added.`,
      );
    }
  }

  /**
   * Serialises structure writes per agency. Must be a transaction's **first**
   * write.
   *
   * "One active structure per person" is held only by `moveMembersHere`'s
   * `$pull`, and snapshot isolation alone does not protect it: two
   * transactions that each put person X on a structure cannot see each
   * other's uncommitted insert, so neither pulls X from the other and both
   * commit. Bumping one shared document first makes them collide — the
   * second gets a WriteConflict (a `TransientTransactionError`), and
   * `withTransaction` re-runs its callback in a fresh transaction whose
   * snapshot includes the first one's commit, so its `$pull` now finds X.
   *
   * `timestamps: false` so the agency's own `updatedAt` does not move on
   * every structure save.
   *
   * ⚠ Only on the transaction path. `TransactionRunner`'s no-replica-set
   * fallback (a dev container that predates `rs0`) runs without a session,
   * so there this is a plain increment and the race above is open — one more
   * reason that fallback must never be how production runs.
   */
  private async lockStructures(
    agencyId: string,
    session: ClientSession | null,
  ): Promise<void> {
    await this.agencyModel.updateOne(
      { _id: new Types.ObjectId(agencyId) },
      { $inc: { payoutStructuresRevision: 1 } },
      { ...sessionOptions(session), timestamps: false },
    );
  }

  /**
   * One active structure per person: take these members off every other one.
   * Bumps those structures' `updatedAt`, so an editor still holding one of
   * them gets a stale 409 instead of putting the person back.
   */
  private async moveMembersHere(
    agencyId: string,
    structureId: Types.ObjectId,
    memberIds: readonly Types.ObjectId[],
    session: ClientSession | null,
  ): Promise<void> {
    if (!memberIds.length) return;
    await this.structureModel.updateMany(
      {
        agencyId,
        status: 'active',
        _id: { $ne: structureId },
        memberIds: { $in: memberIds },
      },
      { $pull: { memberIds: { $in: memberIds } } },
      sessionOptions(session),
    );
  }

  /**
   * A transactional write whose unique-name race surfaces as the same 409.
   *
   * `fn` may run more than once — `withTransaction` re-runs it on a transient
   * error such as the WriteConflict `lockStructures` provokes — so it must
   * only write through `session` and build everything it writes afresh.
   * Only a duplicate key (11000, the active-name index) is translated; a
   * WriteConflict that outlasts the driver's retry window, or any other
   * error, propagates untouched.
   */
  private async write<T>(
    fn: (
      session: ClientSession | null,
      registry: CreatedRegistry,
    ) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.transactions.run(fn);
    } catch (error) {
      if (isDuplicateKeyError(error)) this.nameTaken();
      throw error;
    }
  }
}
