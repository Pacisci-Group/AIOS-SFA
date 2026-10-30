import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PRIMARY_HOUSEHOLD_ROLE,
  RECONCILIATION_HOUSEHOLD_NOT_VISIBLE,
  nextRenewalDate,
  resolveItemCount,
  type AccessContext,
  type HouseholdMemberRole,
  type PolicyType,
  type ServiceTicketAssignee,
  type SoldDocumentMeta,
} from '@sfa/shared';
import { ClientSession, Model, Types } from 'mongoose';
import { clientScopeFilter } from '../common/access/client-scope';
import { displayName } from '../common/domain/user-names';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { TenantContextResolver } from '../common/tenancy/tenant-context.resolver';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import {
  Onboarding,
  OnboardingDocument,
} from '../crm/schemas/onboarding.schema';
import {
  ServiceTicket,
  ServiceTicketDocument,
} from '../crm/schemas/service-ticket.schema';
import { ServiceTicketsService } from '../crm/service-tickets.service';
import { HouseholdMembersService } from '../households/household-members.service';
import { recountHouseholdPolicies } from '../households/household-policy-count';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
import type {
  ContactFieldConflict,
  IntakeAddress,
  IntakeContext,
  IntakePerson,
  StepDeps,
} from '../leads/intake/intake.types';
import { sessionOptions } from '../leads/intake/intake.types';
import { AmbiguousHouseholdException } from '../leads/intake/ambiguous-household.exception';
import { ResolveContactStep } from '../leads/intake/resolve-contact.step';
import { ResolveHouseholdStep } from '../leads/intake/resolve-household.step';
import { normalizePolicyNumber } from '../policies/policy-number';
import { activeRoleHolders } from '../permissions/role-holders';
import { UserRole } from '../permissions/schemas/user-role.schema';
import { Policy, PolicyDocument } from '../policies/schemas/policy.schema';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { parseFormDate } from '../sold-deals/intake/sold.normalize';
import { User, UserDocument } from '../users/schemas/user.schema';

/** A policy Allstate sold directly (1-800), as the service intake records it. */
export interface ServicedPolicyInput {
  policyNumber: string;
  policyType: PolicyType;
  /** The carrier's catalog name — the Dash run's. */
  carrier: string;
  premium: number;
  itemCount: number;
  /** `YYYY-MM-DD`; stored at UTC midnight like every effective date. */
  effectiveDate: string;
  /** Already verified by the caller (`SoldSubmissionValidator.verifyDocument`). */
  newBusinessApplication: SoldDocumentMeta;
}

export interface ServicedPolicyIntakeInput {
  /** An existing client to add the policy to — inside the caller's client scope. */
  householdId?: string | null;
  /** DOB, phone and email required, as on a lead (the DTO enforces it). */
  primaryContact: IntakePerson;
  address?: IntakeAddress;
  members: (IntakePerson & { role: HouseholdMemberRole })[];
  policy: ServicedPolicyInput;
  /** The CSR the household is handed to — its Assigned CRM when it has none. */
  csrId: string;
}

export interface ServicedPolicyIntakeResult {
  householdId: Types.ObjectId;
  policyId: Types.ObjectId;
  householdIsNew: boolean;
  /** Submitted contact details that differ from the stored ones — never applied. */
  conflicts: ContactFieldConflict[];
}

export interface ServicedPolicyHandOff {
  agencyId: string;
  householdId: string;
  policyId: string;
  /** Re-checked when the call opens: one no longer a CSR or CRM is left out. */
  csrId: string | null;
  /** The onboarding's "sold by" line — `Allstate 1-800 (<Bind ID>)`. */
  salesProducerName: string;
  openingNote: string;
  createdByUserId: string;
}

/**
 * Set a 1-800 policy up for service (PAC-173 PR 5): Allstate sold it, the
 * agency services it.
 *
 * **The household half is the lead pipeline minus the lead.** The person and
 * the household are resolved by the same two steps lead intake runs
 * (`HouseholdIntakeModule`), so "the same person" means the same thing in both
 * places; the members and the primary membership are written as
 * `LinkEntitiesStep` writes them, without the lead links. Then one policy,
 * mirroring `UpsertPoliciesStep`'s insert, marked `origin: 'carrier_direct'`
 * with **no deal** — performance and the leaderboard read deals, so nothing is
 * credited to anyone.
 *
 * {@link create} is one transaction and takes a `beforeCommit` hook, so the
 * caller (the Dash row's outcome) is written in the same unit of work: either
 * the household, the policy and the row's outcome all exist, or none does.
 * {@link handOff} opens the CSR's welcome call afterwards, because
 * `ServiceTicketsService.startOnboarding` takes no session; it works from ids
 * alone, so a retry is the same call.
 */
@Injectable()
export class ServicedPolicyIntakeService {
  private readonly logger = new Logger(ServicedPolicyIntakeService.name);

  constructor(
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Onboarding.name)
    private readonly onboardingModel: Model<OnboardingDocument>,
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicketDocument>,
    @InjectModel(AgencyRole.name)
    private readonly roleModel: Model<AgencyRoleDocument>,
    @InjectModel(UserRole.name)
    private readonly userRoleModel: Model<UserRole>,
    private readonly transactions: TransactionRunner,
    private readonly tenancy: TenantContextResolver,
    private readonly contacts: ResolveContactStep,
    private readonly households: ResolveHouseholdStep,
    private readonly memberships: HouseholdMembersService,
    private readonly serviceTickets: ServiceTicketsService,
  ) {}

  /** The CSRs a welcome call can go to — the ticket picker's pool, branch-clamped the same way. */
  assignableCsrs(access: AccessContext): Promise<ServiceTicketAssignee[]> {
    return this.serviceTickets.listAssignees(access);
  }

  async create(
    access: AccessContext,
    branchHeader: string | null,
    input: ServicedPolicyIntakeInput,
    hooks: {
      /**
       * Runs last inside the transaction, with what was created: a throw
       * rolls the household and policy back with it.
       */
      beforeCommit?: (
        session: ClientSession | null,
        created: {
          householdId: Types.ObjectId;
          policyId: Types.ObjectId;
          /** Contact details the form gave that differ from the stored ones. */
          conflicts: ContactFieldConflict[];
        },
      ) => Promise<void>;
    } = {},
  ): Promise<ServicedPolicyIntakeResult> {
    const tenant = await this.tenancy.resolve(access, branchHeader);
    const ctx: IntakeContext = {
      agencyId: tenant.agencyId,
      branchId: tenant.branchId,
      timeZone: access.timeZone,
      // The type wants a producer; nothing here reads it — no lead is made.
      producerId: new Types.ObjectId(access.userId),
      channel: 'internal',
      leadSourceId: null,
      actorUserId: new Types.ObjectId(access.userId),
    };

    // A pinned client must be one the caller can see — the search that offered
    // it is scoped, and a direct POST must be too. Lead intake trusts its pin
    // because only the Household page sets it; this form takes any id.
    if (input.householdId) {
      const visible =
        Types.ObjectId.isValid(input.householdId) &&
        (await this.householdModel.exists({
          ...clientScopeFilter(access),
          _id: new Types.ObjectId(input.householdId),
        }));
      if (!visible) {
        throw new NotFoundException({
          code: RECONCILIATION_HOUSEHOLD_NOT_VISIBLE,
          message: 'That household is not one you can add a policy to.',
        });
      }
    }

    const result = await this.transactions
      .run(async (session, created) => {
        const deps: StepDeps = { ctx, session, created };

        const pinned = input.householdId
          ? await this.households.pin(input.householdId, deps)
          : null;
        const contact = await this.contacts.run(
          input.primaryContact,
          deps,
          pinned?.householdId,
        );
        const household =
          pinned ?? (await this.households.run(contact, input, deps));
        // The person's one household, found by who they are: the same scope
        // rule as a pin and as "which household?", so a client of another
        // branch is refused, not written into.
        if (
          !pinned &&
          !household.isNew &&
          !(await this.householdModel
            .exists({
              ...clientScopeFilter(access),
              _id: household.householdId,
            })
            .session(session))
        ) {
          throw new NotFoundException({
            code: RECONCILIATION_HOUSEHOLD_NOT_VISIBLE,
            message:
              'This person is already a client in a household you cannot add a policy to. Ask the owner to set it up, or to reassign the row.',
          });
        }

        const conflicts: ContactFieldConflict[] = [
          ...(contact.conflicts ?? []),
        ];
        const members: { contactId: Types.ObjectId; role: string }[] = [];
        for (const member of input.members) {
          const resolved = await this.contacts.run(
            member,
            deps,
            pinned?.householdId,
          );
          members.push({ contactId: resolved.contactId, role: member.role });
          conflicts.push(...(resolved.conflicts ?? []));
        }

        const home = await this.link(
          household.householdId,
          household.isNew,
          contact.contactId,
          members,
          deps,
        );

        const effectiveDate = parseFormDate(input.policy.effectiveDate);
        const [policy] = await this.policyModel.create(
          [
            {
              agencyId: ctx.agencyId,
              // The household's branch, like its memberships: whoever can read
              // the household reads its policies.
              branchId: home.branchId ?? ctx.branchId,
              policyNumber: input.policy.policyNumber,
              policyNumberKey:
                normalizePolicyNumber(input.policy.policyNumber) ?? undefined,
              policyType: input.policy.policyType,
              carrier: input.policy.carrier,
              effectiveDate,
              renewalDate: nextRenewalDate(
                effectiveDate,
                input.policy.policyType,
                new Date(),
              ),
              premium: input.policy.premium,
              items: resolveItemCount(
                input.policy.policyType,
                input.policy.itemCount,
              ),
              active: true,
              policyStatus: 'Active',
              // Stamped here, never taken from the client (PAC-56 #23).
              newBusinessApplication: {
                ...input.policy.newBusinessApplication,
                uploadedAt: new Date(),
              },
              householdId: household.householdId,
              origin: 'carrier_direct',
              isTestRecord: false,
            },
          ],
          sessionOptions(session),
        );
        created.track(this.policyModel, policy._id);

        // The CSR becomes the household's Assigned CRM, unless it has one —
        // conditionally, so an existing assignment is never overwritten (the
        // `CrmAssignmentService` technique; its rotation is per producer, and a
        // 1-800 policy has none).
        await this.householdModel.updateOne(
          {
            _id: household.householdId,
            agencyId: ctx.agencyId,
            assignedCrmId: null,
          },
          { $set: { assignedCrmId: new Types.ObjectId(input.csrId) } },
          sessionOptions(session),
        );

        // Last, so nothing after it can fail and leave the caller's write
        // standing on a rolled-back household.
        await hooks.beforeCommit?.(session, {
          householdId: household.householdId,
          policyId: policy._id,
          conflicts,
        });

        return {
          householdId: household.householdId,
          policyId: policy._id,
          householdIsNew: household.isNew,
          conflicts,
        };
      })
      .catch((error: unknown) => this.scopedAmbiguity(access, error));

    await recountHouseholdPolicies(
      { policy: this.policyModel, household: this.householdModel },
      result.householdId,
      this.logger,
    );
    return result;
  }

  /**
   * "Which household?" — as lead intake asks it, but offering only the
   * households the caller can see: the person may belong to one outside their
   * branch, and picking it would be refused. None left is its own answer.
   */
  private async scopedAmbiguity(
    access: AccessContext,
    error: unknown,
  ): Promise<never> {
    if (!(error instanceof AmbiguousHouseholdException)) throw error;
    const body = error.getResponse() as {
      contactId: string;
      households: { id: string }[];
    };
    const ids = body.households
      .map((household) => household.id)
      .filter((id) => Types.ObjectId.isValid(id));
    const visible = new Set(
      (
        await this.householdModel
          .find({
            ...clientScopeFilter(access),
            _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
          })
          .select('_id')
          .lean<{ _id: Types.ObjectId }[]>()
      ).map((row) => String(row._id)),
    );
    const offered = body.households.filter((household) =>
      visible.has(household.id),
    );
    if (offered.length) {
      throw new AmbiguousHouseholdException(body.contactId, offered as never);
    }
    throw new NotFoundException({
      code: RECONCILIATION_HOUSEHOLD_NOT_VISIBLE,
      message:
        'This person belongs to households you cannot add a policy to. Ask the owner to set it up, or to reassign the row.',
    });
  }

  /** Whether a user is still one a welcome call can go to: an active CSR or CRM. */
  private async stillAssignable(
    agencyId: string,
    userId: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return false;
    const holders = await activeRoleHolders(
      {
        roleModel: this.roleModel,
        userRoleModel: this.userRoleModel,
        userModel: this.userModel,
      },
      agencyId,
      // `ServiceTicketsService.listAssignees`' pool.
      ['csr', 'crm'],
      { _id: new Types.ObjectId(userId) },
    );
    return holders.length > 0;
  }

  /**
   * Open the CSR's welcome call — the onboarding chain's first step — for a
   * serviced policy. Post-commit, and **driven by ids**: the client's name and
   * details are read from the household's primary contact, the policy's from
   * the policy, so a retry needs nothing the first call had.
   *
   * Idempotent on the policy: `startOnboarding` dedupes only on a deal, and a
   * serviced policy has none, so an existing onboarding for this household and
   * policy is used instead of opening a second chain — and **repaired** when
   * its welcome call is missing. `startOnboarding` writes the onboarding, then
   * the ticket, with nothing tying the two together, so a failure between them
   * leaves exactly that; a retry opens the call rather than reporting success
   * without one.
   *
   * Throws when no welcome call ends up open, so the caller keeps the row
   * where a retry can reach it.
   */
  async handOff(
    input: ServicedPolicyHandOff,
  ): Promise<{ onboardingId: string; ticketId: string }> {
    const agencyObjectId = new Types.ObjectId(input.agencyId);
    const householdId = new Types.ObjectId(input.householdId);
    const policyId = new Types.ObjectId(input.policyId);

    const existing = await this.onboardingModel.findOne({
      agencyId: agencyObjectId,
      householdId,
      policyId,
    });
    if (existing) {
      let ticketId = await this.welcomeTicketId(agencyObjectId, existing._id);
      if (!ticketId) {
        // The chain's own repair: opens the earliest step with no ticket.
        await this.serviceTickets.reconcileOnboarding(existing);
        ticketId = await this.welcomeTicketId(agencyObjectId, existing._id);
      }
      return {
        onboardingId: String(existing._id),
        ticketId: welcomeCallOrThrow(ticketId),
      };
    }

    const [household, policy, creator] = await Promise.all([
      this.householdModel
        .findOne({ _id: householdId, agencyId: input.agencyId })
        .select('name branchId primaryContactId')
        .lean<{
          name?: string;
          branchId?: string;
          primaryContactId?: Types.ObjectId;
        }>(),
      this.policyModel
        .findOne({ _id: policyId, agencyId: input.agencyId })
        .select('policyNumber policyType')
        .lean<{ policyNumber?: string; policyType?: string }>(),
      this.userModel
        .findById(input.createdByUserId)
        .select('firstName lastName email')
        .lean<{ firstName?: string; lastName?: string; email: string }>(),
    ]);
    if (!household || !policy) {
      throw new NotFoundException('The serviced household or policy is gone.');
    }
    const primary = household.primaryContactId
      ? await this.contactModel
          .findOne({
            _id: household.primaryContactId,
            agencyId: input.agencyId,
          })
          .select('firstName lastName phone email')
          .lean<{
            firstName?: string;
            lastName?: string;
            phone?: string;
            email?: string;
          }>()
      : null;
    const clientName = primary
      ? [primary.firstName, primary.lastName].filter(Boolean).join(' ').trim()
      : '';

    const started = await this.serviceTickets.startOnboarding({
      agencyId: input.agencyId,
      branchId: household.branchId ?? null,
      householdId: input.householdId,
      clientName: clientName || household.name || '',
      salesProducerName: input.salesProducerName,
      dealId: null,
      // Checked again here: a call opened late — a retry, an upload, the
      // owner — must not go to someone removed since. Unassigned, it waits
      // for the CSR desk, as a released chain does.
      assignedUserId:
        input.csrId && (await this.stillAssignable(input.agencyId, input.csrId))
          ? input.csrId
          : null,
      policyId: input.policyId,
      policyNumber: policy.policyNumber ?? '',
      policyType: policy.policyType ?? '',
      householdName: household.name ?? '',
      phone: primary?.phone ?? '',
      email: primary?.email ?? '',
      createdByUserId: input.createdByUserId,
      createdByName: creator ? displayName(creator) : '',
      openingNote: input.openingNote,
    });
    return {
      onboardingId: started.id,
      ticketId: welcomeCallOrThrow(
        started.chain.find((step) => step.ticketId)?.ticketId ?? null,
      ),
    };
  }

  /**
   * The primary and member memberships, and `primaryContactId` — what
   * `LinkEntitiesStep` writes, without the lead. Tenancy comes from the
   * household, not the caller (the same rule as that step). Returns the
   * household's branch for the policy.
   */
  private async link(
    householdId: Types.ObjectId,
    householdIsNew: boolean,
    contactId: Types.ObjectId,
    members: { contactId: Types.ObjectId; role: string }[],
    deps: StepDeps,
  ): Promise<{ branchId: string | null }> {
    const household = await this.householdModel
      .findOne({ _id: householdId })
      .select('agencyId branchId primaryContactId')
      .session(deps.session);
    if (!household) throw new NotFoundException('Household not found');

    const write = { session: deps.session, created: deps.created };
    await this.memberships.add(
      {
        agencyId: household.agencyId,
        branchId: household.branchId,
        householdId,
        contactId,
        role: PRIMARY_HOUSEHOLD_ROLE,
        source: 'intake',
      },
      write,
    );
    for (const member of members) {
      await this.memberships.add(
        {
          agencyId: household.agencyId,
          branchId: household.branchId,
          householdId,
          contactId: member.contactId,
          role: member.role,
          source: 'intake',
        },
        write,
      );
    }

    // As `LinkEntitiesStep`: set the primary only when the household has none,
    // and only when this contact heads no other household — the partial unique
    // index on `{agencyId, primaryContactId}` would otherwise fail the whole
    // intake on an existing client who already leads their own.
    const alreadyPrimaryElsewhere = await this.householdModel
      .exists({
        agencyId: household.agencyId,
        primaryContactId: contactId,
        _id: { $ne: householdId },
      })
      .session(deps.session);
    if (
      !alreadyPrimaryElsewhere &&
      (householdIsNew || !household.primaryContactId)
    ) {
      await this.householdModel.updateOne(
        { _id: householdId },
        { $set: { primaryContactId: contactId } },
        sessionOptions(deps.session),
      );
    }
    return { branchId: household.branchId ?? null };
  }

  private async welcomeTicketId(
    agencyId: Types.ObjectId,
    onboardingId: Types.ObjectId,
  ): Promise<string | null> {
    const ticket = await this.ticketModel
      .findOne({
        agencyId,
        'onboarding.onboardingId': onboardingId,
        'onboarding.stepKey': 'welcome_call',
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }>();
    return ticket ? String(ticket._id) : null;
  }
}

function welcomeCallOrThrow(ticketId: string | null): string {
  if (ticketId) return ticketId;
  throw new ServiceUnavailableException(
    'The welcome call could not be opened.',
  );
}
