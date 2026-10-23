import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DEFAULT_LEAVE_POLICY_RULES,
  type AccessContext,
  type LeavePoliciesResponse,
  type LeavePolicyRules,
  type LeavePolicySummary,
  type LeavePolicyView,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { EmployeeProfilesService } from '../common/hr/employee-profiles.service';
import { mergeRules } from '../common/hr/leave-policy.merge';
import { validateLeavePolicyRules } from '../common/hr/leave-policy.validate';
import type {
  CreateLeavePolicyDto,
  UpdateLeavePolicyDto,
} from './dto/leave-policy.dto';
import {
  LeavePolicy,
  type LeavePolicyDocument,
} from './schemas/leave-policy.schema';

type PolicyLean = {
  _id: Types.ObjectId;
  agencyId: string;
  name: string;
  status: 'active' | 'archived';
  version: number;
  rules: LeavePolicyRules;
  createdAt?: Date;
  updatedAt?: Date;
  archivedAt?: Date | null;
};

/**
 * Leave policies — the HTTP side (PAC-161). The engines never come here;
 * they read through `LeavePolicyService` in `common/hr/`.
 *
 * ## Zero policies is a state, not an error
 *
 * Nothing is seeded and nothing is a default (Asad, 2026-10-22). The list may
 * be empty, the last active policy may be archived, and {@link employeesOn}
 * is the only thing that stops an archive — it counts the non-terminated
 * `employeeProfiles` on the policy (PAC-162).
 */
@Injectable()
export class LeavePoliciesService {
  constructor(
    @InjectModel(LeavePolicy.name)
    private readonly policies: Model<LeavePolicyDocument>,
    private readonly profiles: EmployeeProfilesService,
  ) {}

  async list(agencyId: string): Promise<LeavePoliciesResponse> {
    const rows = await this.policies
      .find({ agencyId })
      .select('-rules')
      .sort({ status: 1, name: 1 })
      .lean<PolicyLean[]>();
    const policies = await Promise.all(rows.map((row) => this.toSummary(row)));
    return { policies };
  }

  async get(agencyId: string, id: string): Promise<LeavePolicyView> {
    const row = await this.find(agencyId, id);
    return { ...(await this.toSummary(row)), rules: row.rules };
  }

  async create(
    access: AccessContext,
    agencyId: string,
    dto: CreateLeavePolicyDto,
  ): Promise<LeavePolicyView> {
    await this.assertNameFree(agencyId, dto.name);
    const { rules } = mergeRules(DEFAULT_LEAVE_POLICY_RULES, dto.rules);
    this.assertConsistent(rules);
    const created = await this.policies.create({
      agencyId,
      name: dto.name,
      status: 'active',
      version: 1,
      rules,
    });
    return this.get(agencyId, created._id.toHexString());
  }

  async update(
    access: AccessContext,
    agencyId: string,
    id: string,
    dto: UpdateLeavePolicyDto,
  ): Promise<LeavePolicyView> {
    const current = await this.find(agencyId, id);
    if (current.status !== 'active') {
      throw new ConflictException('An archived policy cannot be edited.');
    }
    if (dto.name !== undefined && dto.name !== current.name) {
      await this.assertNameFree(agencyId, dto.name);
    }
    const { rules } = mergeRules(current.rules, dto.rules);
    this.assertConsistent(rules);
    await this.policies.updateOne(
      { _id: current._id, agencyId },
      {
        $set: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          rules,
        },
        $inc: { version: 1 },
      },
    );
    return this.get(agencyId, id);
  }

  /**
   * 409 while any employee is on the policy — "move them first". Archiving
   * the last active policy is allowed: the agency then does not use leave.
   */
  async archive(
    access: AccessContext,
    agencyId: string,
    id: string,
  ): Promise<LeavePolicyView> {
    const current = await this.find(agencyId, id);
    if (current.status === 'archived') return this.get(agencyId, id);
    const employees = await this.employeesOn(agencyId, current._id);
    if (employees > 0) {
      throw new ConflictException(
        `Move ${employees} employee${employees === 1 ? '' : 's'} to another policy first.`,
      );
    }
    await this.policies.updateOne(
      { _id: current._id, agencyId, status: 'active' },
      {
        $set: {
          status: 'archived',
          archivedAt: new Date(),
          archivedBy: new Types.ObjectId(access.userId),
        },
      },
    );
    return this.get(agencyId, id);
  }

  /** How many non-terminated employees are on the policy (PAC-162). */
  employeesOn(agencyId: string, policyId: Types.ObjectId): Promise<number> {
    return this.profiles.employeesOnPolicy(agencyId, policyId);
  }

  private async find(agencyId: string, id: string): Promise<PolicyLean> {
    const row = await this.policies
      .findOne({ _id: new Types.ObjectId(id), agencyId })
      .lean<PolicyLean | null>();
    if (!row) throw new NotFoundException('Leave policy not found');
    return row;
  }

  private async assertNameFree(agencyId: string, name: string): Promise<void> {
    const clash = await this.policies.exists({
      agencyId,
      status: 'active',
      name: new RegExp(`^${escapeRegExp(name)}$`, 'i'),
    });
    if (clash) {
      throw new ConflictException(
        `An active policy named "${name}" already exists.`,
      );
    }
  }

  private assertConsistent(rules: LeavePolicyRules): void {
    const problems = validateLeavePolicyRules(rules);
    if (problems.length > 0) {
      throw new BadRequestException(problems.join(' '));
    }
  }

  private async toSummary(row: PolicyLean): Promise<LeavePolicySummary> {
    return {
      id: row._id.toHexString(),
      name: row.name,
      status: row.status,
      version: row.version,
      employeeCount: await this.employeesOn(row.agencyId, row._id),
      createdAt: (row.createdAt ?? new Date(0)).toISOString(),
      updatedAt: (row.updatedAt ?? row.createdAt ?? new Date(0)).toISOString(),
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
