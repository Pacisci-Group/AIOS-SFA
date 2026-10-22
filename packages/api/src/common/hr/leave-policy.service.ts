import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  DeepPartial,
  EffectiveLeaveRules,
  LeavePolicyRules,
  LeavePolicySnapshot,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  LeavePolicy,
  type LeavePolicyDocument,
} from '../../hr/schemas/leave-policy.schema';
import { mergeRules } from './leave-policy.merge';

/** The shape PAC-162 stores on an employee profile. */
export interface EmployeePolicyAssignment {
  leavePolicyId: string | Types.ObjectId;
  overrides?: DeepPartial<LeavePolicyRules> | null;
}

type PolicyLean = {
  _id: Types.ObjectId;
  agencyId: string;
  name: string;
  status: 'active' | 'archived';
  version: number;
  rules: LeavePolicyRules;
};

/**
 * How every engine reads a leave policy (PAC-161). In `common/` so the worker
 * jobs of PAC-165 / PAC-167 can import it; the HTTP side's CRUD is
 * `hr/leave-policies.service.ts`.
 *
 * - {@link effectiveRules} — template + the employee's overrides. `asOf` is
 *   accepted now and ignored: there is no assignment history until PAC-162,
 *   which adds the lookup here without changing a caller.
 * - {@link snapshot} — what a posted record stores, so a later edit never
 *   recalculates history.
 * - {@link hasActivePolicy} — the gate: no policy means no leave requests
 *   and no employee onboarding records (Asad, 2026-10-22).
 */
@Injectable()
export class LeavePolicyService {
  constructor(
    @InjectModel(LeavePolicy.name)
    private readonly policies: Model<LeavePolicyDocument>,
  ) {}

  async effectiveRules(
    agencyId: string,
    assignment: EmployeePolicyAssignment,
    asOf: Date = new Date(),
  ): Promise<EffectiveLeaveRules> {
    // Reserved for PAC-162's assignment history; there is none to look up yet.
    void asOf;
    const policy = await this.policies
      .findOne({
        _id: new Types.ObjectId(String(assignment.leavePolicyId)),
        agencyId,
      })
      .lean<PolicyLean | null>();
    if (!policy || policy.status !== 'active') {
      throw new NotFoundException('Leave policy not found');
    }
    const merged = mergeRules(policy.rules, assignment.overrides);
    return {
      policyId: policy._id.toHexString(),
      policyName: policy.name,
      policyVersion: policy.version,
      overriddenPaths: merged.overriddenPaths,
      rules: merged.rules,
    };
  }

  snapshot(
    effective: EffectiveLeaveRules,
    takenAt: Date = new Date(),
  ): LeavePolicySnapshot {
    return {
      policyId: effective.policyId,
      policyName: effective.policyName,
      policyVersion: effective.policyVersion,
      takenAt: takenAt.toISOString(),
      rules: structuredClone(effective.rules),
    };
  }

  async activeCount(agencyId: string): Promise<number> {
    return this.policies.countDocuments({ agencyId, status: 'active' });
  }

  async hasActivePolicy(agencyId: string): Promise<boolean> {
    return (await this.activeCount(agencyId)) > 0;
  }
}
