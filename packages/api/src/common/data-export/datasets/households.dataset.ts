import {
  HOUSEHOLD_STATUSES,
  householdStatusQueryValues,
  isActivePolicyStatus,
  normalizeContactRole,
  normalizeHouseholdStatus,
  normalizePolicyType,
} from '@sfa/shared';
import type { Types } from 'mongoose';
import { Household } from '../../../households/schemas/household.schema';
import { defineDataset } from '../engine/dataset.types';
import type {
  AddressLike,
  MembershipLite,
  PolicyLite,
} from '../engine/lookups';
import {
  addressColumns,
  columnsFor,
  contactColumns,
  distinct,
  primeTenant,
  tenantColumns,
  type TenantFields,
  userColumns,
} from './columns';

interface HouseholdRow extends TenantFields {
  householdRef?: string;
  name?: string;
  status?: string;
  propertyAddress?: AddressLike;
  mailingAddress?: AddressLike;
  assignedCrmId?: Types.ObjectId;
  legacyAssignedCrmId?: string;
  totalActivePolicies?: number;
  primaryContactId?: Types.ObjectId;
  dataQuality?: string;
  leadIds?: Types.ObjectId[];
}

interface HouseholdJoins {
  members: Map<string, MembershipLite[]>;
  policies: Map<string, PolicyLite[]>;
}

const col = columnsFor<HouseholdRow, HouseholdJoins>();

const membersOf = (row: HouseholdRow, joins: HouseholdJoins) =>
  joins.members.get(String(row._id)) ?? [];
const policiesOf = (row: HouseholdRow, joins: HouseholdJoins) =>
  joins.policies.get(String(row._id)) ?? [];
const activePoliciesOf = (row: HouseholdRow, joins: HouseholdJoins) =>
  policiesOf(row, joins).filter((policy) =>
    isActivePolicyStatus(policy.policyStatus),
  );

/**
 * Households (SmartSuite *Households*). One row per household, with its
 * current members and its book rolled up — the "Total Active Policies"
 * SmartSuite computed, recomputed here from policy status.
 */
export const householdsDataset = defineDataset<HouseholdRow, HouseholdJoins>({
  key: 'households',
  label: 'Households',
  description:
    'One row per household: addresses, primary contact, current members, client relations manager and active policies.',
  model: Household.name,
  scope: 'client',
  dateFields: [
    {
      key: 'created',
      label: 'Recorded at',
      path: 'createdAt',
      kind: 'instant',
      isDefault: true,
    },
  ],
  filters: ['branchId', 'status'],
  status: {
    values: HOUSEHOLD_STATUSES,
    queryValues: householdStatusQueryValues,
    path: 'status',
  },

  async joins(rows, { lookups }) {
    const ids = rows.map((row) => row._id);
    const [members, policies] = await Promise.all([
      lookups.membershipsBy('householdId', ids),
      lookups.policiesBy('householdId', ids),
      primeTenant(
        lookups,
        rows,
        rows.map((row) => row.assignedCrmId),
      ),
    ]);
    await lookups.contacts.load([
      ...rows.map((row) => row.primaryContactId),
      ...[...members.values()].flat().map((member) => member.contactId),
    ]);
    return { members, policies };
  },

  columns: [
    col('household_id', 'id', 'Household record id.', (row) => row._id),
    col(
      'household_ref',
      'string',
      'Household reference, e.g. HH-2026-0042.',
      (row) => row.householdRef,
    ),
    col('name', 'string', 'Household name.', (row) => row.name),
    col('status', 'string', 'Household status.', (row) =>
      row.status ? normalizeHouseholdStatus(row.status) : null,
    ),
    col(
      'status_raw',
      'string',
      'Status exactly as stored; migrated rows may hold a SmartSuite code.',
      (row) => row.status,
    ),
    ...addressColumns<HouseholdRow>(
      'property',
      'Property address',
      (row) => row.propertyAddress,
      { street2: true },
    ),
    ...addressColumns<HouseholdRow>(
      'mailing',
      'Mailing address',
      (row) => row.mailingAddress,
      { street2: true },
    ),
    ...contactColumns<HouseholdRow>(
      'primary_contact',
      'Primary contact',
      (row) => row.primaryContactId,
      {
        dateOfBirth: true,
      },
    ),
    ...userColumns<HouseholdRow>(
      'client_relations_manager',
      'Assigned client relations manager',
      (row) => row.assignedCrmId,
    ),
    col(
      'member_count',
      'number',
      'Current household members.',
      (row, ctx) => membersOf(row, ctx.joins).length,
    ),
    col(
      'member_contact_ids',
      'list',
      'Their contact ids, in the same order as the names.',
      (row, ctx) => membersOf(row, ctx.joins).map((member) => member.contactId),
    ),
    col('member_names', 'list', 'Their names.', (row, ctx) =>
      membersOf(row, ctx.joins).map(
        (member) => ctx.lookups.contacts.get(member.contactId)?.name ?? '',
      ),
    ),
    col('member_roles', 'list', 'Their roles, in the same order.', (row, ctx) =>
      membersOf(row, ctx.joins).map(
        (member) => normalizeContactRole(member.role) || '',
      ),
    ),
    col(
      'policy_count',
      'number',
      'Policies on the household, any status.',
      (row, ctx) => policiesOf(row, ctx.joins).length,
    ),
    col(
      'active_policy_count',
      'number',
      'Policies whose status is Active.',
      (row, ctx) => activePoliciesOf(row, ctx.joins).length,
    ),
    col('active_policy_numbers', 'list', 'Their policy numbers.', (row, ctx) =>
      activePoliciesOf(row, ctx.joins).map((policy) => policy.policyNumber),
    ),
    col('active_policy_types', 'list', 'Their lines of business.', (row, ctx) =>
      distinct(
        activePoliciesOf(row, ctx.joins).map((policy) =>
          normalizePolicyType(policy.policyType),
        ),
      ),
    ),
    col(
      'active_premium',
      'number',
      'Total premium of those policies.',
      (row, ctx) =>
        activePoliciesOf(row, ctx.joins).reduce(
          (sum, policy) => sum + (policy.premium ?? 0),
          0,
        ),
    ),
    col(
      'total_active_policies_stored',
      'number',
      'The stored Total Active Policies figure, kept beside the recomputed one for reconciliation.',
      (row) => row.totalActivePolicies,
    ),
    col(
      'lead_count',
      'number',
      'Leads linked to the household.',
      (row) => row.leadIds?.length ?? 0,
    ),
    col('lead_ids', 'list', 'Those lead ids.', (row) => row.leadIds),
    col(
      'data_quality',
      'string',
      'Data-quality flag from the migration.',
      (row) => row.dataQuality,
    ),
    col(
      'legacy_assigned_crm_id',
      'id',
      'SmartSuite id of the assigned CRM.',
      (row) => row.legacyAssignedCrmId,
    ),
    ...tenantColumns<HouseholdRow>(),
  ],
});
