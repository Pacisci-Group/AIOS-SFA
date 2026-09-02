import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ALL_MODULE_KEYS,
  ModuleKey,
  type AgencyAvailabilityResponse,
  type OnboardAgencyResponse,
  type OwnerInviteEmailStatus,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { AuditTemplate } from '../audit-templates/schemas/audit-template.schema';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import { AGENCY_OWNER_SLUG } from '../permissions/owner-protection.service';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { seedAuditTemplates } from '../seed/audit-templates.seed';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import {
  toBranchSlug,
  type AgencyAvailabilityQueryDto,
  type OnboardAgencyDto,
} from './dto/onboard-agency.dto';
import { Agency, AgencyDocument } from './schemas/agency.schema';

/** One reversible step of the provisioning sequence. */
type Undo = () => Promise<unknown>;

/**
 * Turning "a new client signed" into a tenant somebody can log into (PAC-69).
 *
 * ## What this replaced
 * `PlatformService.createAgency` wrote the agency document and seeded roles, and
 * stopped there — no branch, so no record could be written (`TenantRecord.branchId`
 * is required), and no user, so nobody could sign in. The only thing that had
 * ever produced a complete tenant was the SmartSuite migration.
 *
 * ## Why not `provisionTenant()`
 * `src/seed/provision-tenant.ts` does almost exactly this sequence and is
 * deliberately **not** reused. It is find-or-create, because the migration has
 * to be resumable; here a slug that already exists is an operator mistake that
 * must be reported, not an existing tenant to silently adopt and hand a new
 * owner account. The two paths share the pieces that matter — `seedDefaultRoles`
 * and `seedAuditTemplates` — and differ on that one rule.
 *
 * ## Why this rolls back by hand instead of using `TransactionRunner`
 * `TransactionRunner` looks like the obvious tool and would be actively worse
 * here. On a replica set — which is local dev, CI and production — it takes the
 * transaction path, where its compensation registry is a no-op because a real
 * transaction would abort instead. But **none of the collaborators accept a
 * session**: `seedDefaultRoles`, `setUserRoles` (both `bulkWrite`, which bypasses
 * Mongoose middleware entirely), `seedAuditTemplates` and the user insert all
 * write on their own connection. Only the agency and branch documents would
 * actually be inside the transaction, and the result would *look* atomic while
 * silently leaking roles, templates and a user. `withTransaction` also re-runs
 * its callback on a transient error, and the second run would hit
 * `assertEmailAvailable` and 409 on the user the first run created.
 *
 * So the rollback is explicit: each step pushes its own undo, and a failure runs
 * them in reverse. Every undo swallows and logs its own errors — a rollback that
 * throws halfway leaves *more* behind than one that keeps going.
 *
 * ## The email is deliberately outside the rollback
 * See {@link onboard}. This is the one ordering constraint in the whole file.
 */
@Injectable()
export class AgencyProvisioningService {
  private readonly logger = new Logger(AgencyProvisioningService.name);

  constructor(
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
    @InjectModel(Branch.name) private branchModel: Model<BranchDocument>,
    @InjectModel(AgencyRole.name) private roleModel: Model<AgencyRoleDocument>,
    @InjectModel(AuditTemplate.name)
    private auditTemplateModel: Model<AuditTemplate>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private roleAssignments: RoleAssignmentsService,
    private usersService: UsersService,
  ) {}

  /**
   * Is each of these free? Backs the wizard's inline field checks.
   *
   * A `false` here is advisory — the operator may still submit, and
   * {@link onboard} re-checks under the same rules. This exists so the answer
   * arrives while they are still looking at the field, not five steps later.
   */
  async checkAvailability(
    query: AgencyAvailabilityQueryDto,
  ): Promise<AgencyAvailabilityResponse> {
    const slug = query.slug?.trim().toLowerCase();
    const email = query.email?.trim().toLowerCase();
    const ticker = query.ticker?.trim().toUpperCase();

    const [slugTaken, emailTaken, tickerTaken] = await Promise.all([
      slug ? this.agencyModel.exists({ slug }) : null,
      // Platform-wide, not per agency: `User.email` is globally unique.
      email ? this.userModel.exists({ email }) : null,
      ticker ? this.agencyModel.exists({ ticker }) : null,
    ]);

    return {
      slugAvailable: slug ? !slugTaken : null,
      emailAvailable: email ? !emailTaken : null,
      tickerAvailable: ticker ? !tickerTaken : null,
    };
  }

  /**
   * Create the agency, its roles, its first branch, its audit checklist and its
   * owner — then ask for the invite email.
   *
   * ## Why the email is sent after the point of no return
   * Every step up to the owner's invite token is undone on failure. The email is
   * not, and must not be: `InngestService.send` writes the event to `eventLog`
   * **before** handing it to Inngest, and the event-log sweep replays a stranded
   * row later. `send-invite-email.fn.ts` mails whatever the payload says without
   * re-reading the user. So a "delivery failed, roll the tenant back" path ends
   * with a real email arriving at a real person carrying a link to an account
   * that no longer exists — the single worst outcome available here.
   *
   * A failed dispatch is therefore reported as `emailStatus: 'failed'` on a
   * `201`, and the operator resends with {@link resendOwnerInvite}. The tenant
   * is correct either way; only the notification is missing.
   */
  async onboard(
    input: OnboardAgencyDto,
    operator: { userId: string },
  ): Promise<OnboardAgencyResponse> {
    const slug = input.agency.slug.trim().toLowerCase();
    const email = input.owner.email.trim().toLowerCase();
    const ticker = input.agency.ticker?.trim().toUpperCase();

    // Pre-flight, before anything is written. These are the two failures an
    // operator actually hits, and catching them here means the common case never
    // exercises the rollback at all.
    await this.assertSlugAvailable(slug);
    if (ticker) await this.assertTickerAvailable(ticker);
    await this.usersService.assertEmailAvailable(email);

    const undo: Undo[] = [];

    try {
      const agency = await this.agencyModel.create({
        name: input.agency.name.trim(),
        slug,
        status: 'active',
        modules: this.entitlements(input.modules, operator.userId),
        ...(ticker ? { ticker } : {}),
        ...(input.agency.allstateAgencyId
          ? {
              allstateAgencyId: input.agency.allstateAgencyId
                .trim()
                .toUpperCase(),
            }
          : {}),
        // The one place `pending` is ever written — see `AgencySetup`.
        setup: { status: 'pending' },
      });
      const agencyId = agency._id;
      undo.push(() => this.agencyModel.deleteOne({ _id: agencyId }));

      // Must follow the permission catalog from the core seed: `setRolePermissions`
      // resolves each key to a catalog id and refuses one it cannot find.
      await this.roleAssignments.seedDefaultRoles(agencyId);
      undo.push(async () => {
        // Through the service, which is the only writer of the three join
        // collections; a `deleteMany` here would be the second writer the whole
        // relational-RBAC design exists to prevent.
        await this.roleAssignments.purgeAgency(agencyId);
        await this.roleModel.deleteMany({ agencyId });
      });

      const branchName = input.branch.name.trim();
      const branch = await this.branchModel.create({
        agencyId,
        name: branchName,
        slug: toBranchSlug(branchName),
        isDefault: true,
        address: input.branch.address,
      });
      const branchId = branch._id;
      undo.push(() => this.branchModel.deleteOne({ _id: branchId }));

      /*
       * Platform-defined content, tenant-scoped storage. `AuditGenerationService`
       * resolves the titles it computes against this collection **by exact name**,
       * so a tenant with an empty catalog books sold deals that generate no
       * service hand-off at all — silently, because generation is best-effort.
       */
      await seedAuditTemplates(
        this.auditTemplateModel,
        agencyId.toString(),
        branchId.toString(),
      );
      undo.push(() =>
        // ⚠ A **string**. `AuditTemplate` extends `TenantRecord`, whose
        // `agencyId` is a plain string, while `branches` and `roles` store an
        // ObjectId. An ObjectId filter here would match nothing and delete
        // nothing, silently.
        this.auditTemplateModel.deleteMany({ agencyId: agencyId.toString() }),
      );

      const ownerRole = await this.roleModel.findOne({
        agencyId,
        slug: AGENCY_OWNER_SLUG,
      });
      if (!ownerRole) {
        throw new Error(
          `Agency Owner role missing after seeding roles for ${slug}.`,
        );
      }

      /*
       * ⚠ Registered **before** the call, and keyed on the email rather than on
       * an id we do not have yet.
       *
       * `createPendingUser` creates the user row and *then* assigns roles, so a
       * failure inside it leaves a user behind that an undo registered
       * afterwards would never see — the call threw, so nothing was pushed. That
       * is not hypothetical: role assignment is the step most likely to fail
       * here, because it is the one that talks to the permission catalog.
       */
      undo.push(async () => {
        const orphan = await this.userModel
          .findOne({ agencyId, email })
          .select('_id');
        if (!orphan) return;
        await this.roleAssignments.purgeUser(orphan._id);
        await this.userModel.deleteOne({ _id: orphan._id });
      });

      const owner = await this.usersService.createPendingUser({
        agencyId: agencyId.toString(),
        branchId: branchId.toString(),
        email,
        roleIds: [ownerRole._id.toString()],
        firstName: input.owner.firstName.trim(),
        lastName: input.owner.lastName.trim(),
        invitedByUserId: operator.userId,
        // Assigning the Agency Owner role is reserved for platform accounts by
        // `OwnerProtectionService`; this is one.
        invitedByIsPlatformAdmin: true,
      });

      const minted = await this.usersService.mintInviteToken(owner);

      // ── Point of no return. Nothing below is undone. ────────────────────
      const emailStatus = await this.dispatchOwnerInvite(
        owner,
        minted,
        operator.userId,
      );

      const invite = this.usersService.inviteResponse(owner, minted);
      return {
        agency: {
          id: agencyId.toString(),
          name: agency.name,
          slug: agency.slug,
        },
        branch: { id: branchId.toString(), name: branch.name },
        owner: {
          userId: invite.userId,
          email: owner.email,
          inviteUrl: invite.inviteUrl,
          expiresAt: invite.expiresAt,
          emailStatus,
          ...(invite.inviteToken ? { inviteToken: invite.inviteToken } : {}),
        },
      };
    } catch (error) {
      await this.rollback(undo, slug);
      throw error;
    }
  }

  /**
   * Send the owner's invite again — the recovery path for
   * `emailStatus: 'failed'`, and for an invite that expired before it was used.
   *
   * A platform operator cannot use `POST /users/:userId/invite/resend`: that is
   * gated on `agency:users:write`, and a platform account holds
   * `ALL_PLATFORM_PERMISSIONS` and no agency permission at all. Without this
   * endpoint a failed delivery would need a database edit to recover from.
   */
  async resendOwnerInvite(
    agencyId: string,
  ): Promise<OnboardAgencyResponse['owner']> {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found');
    }
    const agency = await this.agencyModel.findById(agencyId).select('_id');
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    const owner = await this.findPendingOwner(agency._id);
    // Reuses the tenant-side resend, so the cooldown, the token rotation and
    // the "already accepted" / "was removed" guards are the same ones the
    // owner's own users list is held to.
    const invite = await this.usersService.resendInvite(
      agency._id.toString(),
      owner._id.toString(),
    );

    return {
      userId: invite.userId,
      email: owner.email,
      inviteUrl: invite.inviteUrl,
      expiresAt: invite.expiresAt,
      emailStatus: 'queued',
      ...(invite.inviteToken ? { inviteToken: invite.inviteToken } : {}),
    };
  }

  /** The agency's not-yet-accepted owner, or a 409 explaining why there isn't one. */
  private async findPendingOwner(
    agencyId: Types.ObjectId,
  ): Promise<UserDocument> {
    const ownerRole = await this.roleModel
      .findOne({ agencyId, slug: AGENCY_OWNER_SLUG })
      .select('_id');
    if (!ownerRole) {
      throw new NotFoundException('This agency has no Agency Owner role.');
    }

    const ownerIds = await this.roleAssignments.roleUserIds(ownerRole._id);
    if (!ownerIds.length) {
      throw new NotFoundException('This agency has no owner to invite.');
    }

    const owner = await this.userModel.findOne({
      _id: { $in: ownerIds },
      isActive: false,
      deactivatedAt: null,
    });
    if (!owner) {
      throw new ConflictException(
        'This agency’s owner has already accepted their invite.',
      );
    }
    return owner;
  }

  /**
   * Hand the invite to the async platform, reporting rather than throwing.
   *
   * The tenant is already committed by the time this runs, so a delivery failure
   * is a message the operator needs, not an error that should unwind anything.
   */
  private async dispatchOwnerInvite(
    owner: UserDocument,
    minted: Awaited<ReturnType<UsersService['mintInviteToken']>>,
    operatorId: string,
  ): Promise<OwnerInviteEmailStatus> {
    try {
      await this.usersService.dispatchInviteEmail(owner, minted, operatorId, {
        kind: 'owner',
      });
      return 'queued';
    } catch (error) {
      this.logger.warn(
        `Agency onboarded, but the owner invite to ${owner.email} could not be ` +
          'dispatched. The tenant is intact; resend from the panel.',
        error instanceof Error ? error.stack : String(error),
      );
      return 'failed';
    }
  }

  /** Every module key, with the chosen ones enabled and stamped. */
  private entitlements(
    enabled: ModuleKey[],
    enabledBy: string,
  ): Record<
    string,
    { enabled: boolean; enabledAt?: Date; enabledBy?: string }
  > {
    const chosen = new Set(enabled);
    const enabledAt = new Date();
    return Object.fromEntries(
      ALL_MODULE_KEYS.map((key) => [
        key,
        // The same shape `updateModuleEntitlements` writes, so the entitlement
        // audit trail does not depend on which surface switched a module on.
        chosen.has(key)
          ? { enabled: true, enabledAt, enabledBy }
          : { enabled: false },
      ]),
    );
  }

  private async assertSlugAvailable(slug: string): Promise<void> {
    if (await this.agencyModel.exists({ slug })) {
      throw new ConflictException(
        `The slug "${slug}" is already taken by another agency.`,
      );
    }
  }

  private async assertTickerAvailable(ticker: string): Promise<void> {
    if (await this.agencyModel.exists({ ticker })) {
      throw new ConflictException(
        `The ticker "${ticker}" already belongs to another agency.`,
      );
    }
  }

  /**
   * Undo everything that was written, newest first.
   *
   * Each step is isolated: one failing undo must not stop the others, or a
   * partially-rolled-back tenant would be left in a state neither this endpoint
   * nor a retry can make sense of. What it cannot clean up, it says out loud.
   */
  private async rollback(undo: Undo[], slug: string): Promise<void> {
    if (!undo.length) return;
    this.logger.warn(
      `Onboarding "${slug}" failed — rolling back ${undo.length} step(s).`,
    );
    for (const step of [...undo].reverse()) {
      try {
        await step();
      } catch (error) {
        this.logger.error(
          `Rollback step failed while undoing "${slug}". Some records may ` +
            'have been left behind and need removing by hand.',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
