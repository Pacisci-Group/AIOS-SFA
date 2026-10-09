import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type AccessContext,
  type AnalyticsOptionsResponse,
  carrierSlug,
  normalizeCarrier,
} from '@sfa/shared';
import { Model } from 'mongoose';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import { clientAgencyId } from '../common/access/client-scope';
import { filterOptionsFor } from '../common/access/filter-options';
import { displayNamesFor } from '../common/domain/user-names';
import {
  ServiceTicket,
  ServiceTicketDocument,
} from '../crm/schemas/service-ticket.schema';
import { buildTicketScopeFilter } from '../crm/ticket-scope';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import { Policy, PolicyDocument } from '../policies/schemas/policy.schema';
import { AgencyRole } from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

/**
 * What the Analytics filter bar can offer (PAC-152, part 2), behind
 * `analytics:read` alone.
 *
 * Branches and producers are the Data Export page's list
 * (`filterOptionsFor`) — the same scope rules, one implementation. Assignees
 * are the people tickets in the caller's ticket scope are actually assigned
 * to, so a CSR with no producer role still appears. Carriers are whatever the
 * agency's policies hold, alias codes folded into their name.
 */
@Injectable()
export class AnalyticsOptionsService {
  constructor(
    @InjectModel(Branch.name)
    private readonly branchModel: Model<BranchDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name) private readonly roleModel: Model<unknown>,
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicketDocument>,
    private readonly roleAssignments: RoleAssignmentsService,
  ) {}

  async options(access: AccessContext): Promise<AnalyticsOptionsResponse> {
    const [base, carriers, assignees] = await Promise.all([
      filterOptionsFor(access, {
        branchModel: this.branchModel,
        userModel: this.userModel,
        roleModel: this.roleModel,
        roleUserIds: (roleId) => this.roleAssignments.roleUserIds(roleId),
      }),
      this.carriers(access),
      this.assignees(access),
    ]);
    return { ...base, assignees, carriers };
  }

  private async carriers(access: AccessContext): Promise<string[]> {
    const raw = (await this.policyModel.distinct('carrier', {
      agencyId: clientAgencyId(access),
      isTestRecord: { $ne: true },
    })) as unknown[];
    const bySlug = new Map<string, string>();
    for (const value of raw) {
      const name = normalizeCarrier(typeof value === 'string' ? value : '');
      const slug = carrierSlug(name);
      if (slug && !bySlug.has(slug)) bySlug.set(slug, name);
    }
    return [...bySlug.values()].sort((a, b) => a.localeCompare(b));
  }

  private async assignees(
    access: AccessContext,
  ): Promise<AnalyticsOptionsResponse['assignees']> {
    const ids = await this.ticketModel.distinct('assignedUserId', {
      ...buildTicketScopeFilter<ServiceTicketDocument>(access),
      isTestRecord: { $ne: true },
      assignedUserId: { $ne: null },
    });
    const names = await displayNamesFor(
      this.userModel,
      ids.map((id) => id.toString()),
    );
    return [...names]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
