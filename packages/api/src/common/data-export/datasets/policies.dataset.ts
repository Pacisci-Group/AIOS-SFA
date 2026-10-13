import {
  isActivePolicyStatus,
  normalizeCarrier,
  normalizePolicyStatus,
  normalizePolicyType,
  POLICY_STATUSES,
  policyStatusQueryValues,
} from '@sfa/shared';
import type { Types } from 'mongoose';
import { Policy } from '../../../policies/schemas/policy.schema';
import { ymdDate } from '../engine/cells';
import { defineDataset } from '../engine/dataset.types';
import type { InterestedPartyLite } from '../engine/lookups';
import {
  addressColumns,
  columnsFor,
  contactColumns,
  householdColumns,
  primeTenant,
  tenantColumns,
  type TenantFields,
  userColumns,
} from './columns';

interface ProofBacked {
  selected?: boolean;
  attachment?: { filename?: string };
}

interface PolicyRow extends TenantFields {
  policyNumber?: string;
  policyType?: string;
  carrier?: string;
  active?: boolean;
  policyStatus?: string;
  effectiveDate?: Date;
  expirationDate?: Date;
  renewalDate?: Date;
  premium?: number;
  items?: number;
  notes?: string;
  householdId?: Types.ObjectId;
  dealId?: Types.ObjectId;
  transferredToPolicyId?: Types.ObjectId | null;
  transferredFromPolicyId?: Types.ObjectId | null;
  discounts?: Partial<{
    escrow: boolean;
    fireSubscription: ProofBacked;
    roofReceipt: ProofBacked;
    acvPersonalProperty: boolean;
    acvDwellingProtection: boolean;
    drivewise: boolean;
    defensiveDriver: { selected?: boolean; drivers?: { name?: string }[] };
    studentDiscount: ProofBacked;
    priorInsuranceDiscount: boolean;
  }>;
  newBusinessApplication?: { filename?: string; uploadedAt?: Date };
  legacyHouseholdId?: string;
  legacyDealId?: string;
}

interface PolicyJoins {
  interestedParties: Map<string, InterestedPartyLite>;
  chargebacks: Set<string>;
}

const col = columnsFor<PolicyRow, PolicyJoins>();

/**
 * Policies (SmartSuite *Policies*). One row per policy, with the lookups the
 * Policies table carried through its household and deal: household name and
 * client relations manager, sold date and producer.
 *
 * Client-scoped: a policy has no owner of its own, so under `own` scope it
 * collapses to the caller's branch — the rule the Clients pages already apply.
 * The producer on the row is the **deal's**, named for its provenance.
 */
export const policiesDataset = defineDataset<PolicyRow, PolicyJoins>({
  key: 'policies',
  label: 'Policies',
  description:
    'One row per policy: number, type, carrier, status, dates and premium, with its household, the deal that sold it, and its discounts.',
  model: Policy.name,
  scope: 'client',
  dateFields: [
    {
      key: 'effective_date',
      label: 'Effective date',
      path: 'effectiveDate',
      kind: 'utcDate',
      isDefault: true,
    },
    {
      key: 'renewal_date',
      label: 'Renewal date',
      path: 'renewalDate',
      kind: 'utcDate',
    },
    {
      key: 'expiration_date',
      label: 'Expiration date',
      path: 'expirationDate',
      kind: 'utcDate',
    },
    {
      key: 'created',
      label: 'Recorded at',
      path: 'createdAt',
      kind: 'instant',
    },
  ],
  filters: ['branchId', 'status', 'policyTypes'],
  status: {
    values: POLICY_STATUSES,
    queryValues: policyStatusQueryValues,
    path: 'policyStatus',
  },
  policyTypePath: 'policyType',

  async joins(rows, { lookups }) {
    const ids = rows.map((row) => row._id);
    await Promise.all([
      lookups.households.load(rows.map((row) => row.householdId)),
      lookups.deals.load(rows.map((row) => row.dealId)),
    ]);
    await Promise.all([
      primeTenant(lookups, rows, [
        ...rows.map(
          (row) => lookups.households.get(row.householdId)?.assignedCrmId,
        ),
        ...rows.map((row) => lookups.deals.get(row.dealId)?.producerId),
      ]),
      lookups.contacts.load(
        rows.map(
          (row) => lookups.households.get(row.householdId)?.primaryContactId,
        ),
      ),
    ]);
    const [interestedParties, chargebacks] = await Promise.all([
      lookups.interestedPartyByPolicy(ids),
      lookups.chargebackPolicyIds(ids),
    ]);
    return { interestedParties, chargebacks };
  },

  columns: [
    col('policy_id', 'id', 'Policy record id.', (row) => row._id),
    col('policy_number', 'id', 'Policy number.', (row) => row.policyNumber),
    col('policy_type', 'string', 'Line of business.', (row) =>
      row.policyType ? normalizePolicyType(row.policyType) : null,
    ),
    col(
      'policy_type_raw',
      'string',
      'Type exactly as stored; migrated rows may hold a SmartSuite code.',
      (row) => row.policyType,
    ),
    col('carrier', 'string', 'Carrier.', (row) =>
      row.carrier ? normalizeCarrier(row.carrier) : null,
    ),
    col(
      'carrier_raw',
      'string',
      'Carrier exactly as stored.',
      (row) => row.carrier,
    ),
    col('policy_status', 'string', 'Policy status.', (row) =>
      row.policyStatus ? normalizePolicyStatus(row.policyStatus) : null,
    ),
    col(
      'is_active',
      'boolean',
      'Whether the status counts as in force.',
      (row) => isActivePolicyStatus(row.policyStatus),
    ),
    col(
      'active_flag',
      'boolean',
      'The legacy Active checkbox, kept for reconciliation (PAC-125).',
      (row) => row.active,
    ),
    col(
      'effective_date',
      'date',
      'Effective date.',
      (row) => row.effectiveDate,
    ),
    col(
      'expiration_date',
      'date',
      'Expiration date.',
      (row) => row.expirationDate,
    ),
    col('renewal_date', 'date', 'Renewal date.', (row) => row.renewalDate),
    col('premium', 'number', 'Premium.', (row) => row.premium),
    col('items', 'number', 'Items (vehicles, etc.).', (row) => row.items),
    ...householdColumns<PolicyRow>((row) => row.householdId),
    ...addressColumns<PolicyRow>(
      'household_property',
      'Household property address',
      (row, ctx) =>
        ctx.lookups.households.get(row.householdId)?.propertyAddress,
      { street2: true },
    ),
    ...contactColumns<PolicyRow>(
      'primary_contact',
      "Household's primary contact",
      (row, ctx) =>
        ctx.lookups.households.get(row.householdId)?.primaryContactId,
    ),
    ...userColumns<PolicyRow>(
      'client_relations_manager',
      "Household's assigned client relations manager",
      (row, ctx) => ctx.lookups.households.get(row.householdId)?.assignedCrmId,
    ),
    col('deal_id', 'id', 'Deal that sold the policy.', (row) => row.dealId),
    col(
      'deal_number',
      'number',
      'That deal’s number.',
      (row, ctx) => ctx.lookups.deals.get(row.dealId)?.dealAutoNumber,
    ),
    col('sold_date', 'date', 'That deal’s sold date.', (row, ctx) =>
      ymdDate(ctx.lookups.deals.get(row.dealId)?.soldDateYmd),
    ),
    col(
      'deal_type',
      'string',
      'That deal’s type.',
      (row, ctx) => ctx.lookups.deals.get(row.dealId)?.dealType,
    ),
    ...userColumns<PolicyRow>(
      'deal_producer',
      'Producer on the deal that sold the policy',
      (row, ctx) => ctx.lookups.deals.get(row.dealId)?.producerId,
    ),
    col(
      'has_chargeback',
      'boolean',
      'A chargeback is recorded against the policy.',
      (row, ctx) => ctx.joins.chargebacks.has(String(row._id)),
    ),
    col(
      'mortgagee',
      'string',
      'Mortgagee / interested party.',
      (row, ctx) => ctx.joins.interestedParties.get(String(row._id))?.mortgagee,
    ),
    col(
      'loan_number',
      'string',
      'Loan number with that mortgagee.',
      (row, ctx) =>
        ctx.joins.interestedParties.get(String(row._id))?.loanNumber,
    ),
    col(
      'discount_escrow',
      'boolean',
      'Paid through escrow.',
      (row) => row.discounts?.escrow,
    ),
    col(
      'discount_fire_subscription',
      'boolean',
      'Fire subscription discount.',
      (row) => row.discounts?.fireSubscription?.selected,
    ),
    col(
      'discount_fire_subscription_proof',
      'string',
      'Proof document filename.',
      (row) => row.discounts?.fireSubscription?.attachment?.filename,
    ),
    col(
      'discount_roof_receipt',
      'boolean',
      'Hail-resistant roof discount.',
      (row) => row.discounts?.roofReceipt?.selected,
    ),
    col(
      'discount_roof_receipt_proof',
      'string',
      'Proof document filename.',
      (row) => row.discounts?.roofReceipt?.attachment?.filename,
    ),
    col(
      'discount_acv_personal_property',
      'boolean',
      'Actual cash value — personal property.',
      (row) => row.discounts?.acvPersonalProperty,
    ),
    col(
      'discount_acv_dwelling_protection',
      'boolean',
      'Actual cash value — dwelling protection.',
      (row) => row.discounts?.acvDwellingProtection,
    ),
    col(
      'discount_drivewise',
      'boolean',
      'Drivewise enrolled.',
      (row) => row.discounts?.drivewise,
    ),
    col(
      'discount_defensive_driver',
      'boolean',
      'Defensive driver discount.',
      (row) => row.discounts?.defensiveDriver?.selected,
    ),
    col(
      'discount_defensive_driver_names',
      'list',
      'Drivers named on it.',
      (row) =>
        (row.discounts?.defensiveDriver?.drivers ?? []).map(
          (driver) => driver.name,
        ),
    ),
    col(
      'discount_student',
      'boolean',
      'Good student discount.',
      (row) => row.discounts?.studentDiscount?.selected,
    ),
    col(
      'discount_student_proof',
      'string',
      'Proof document filename.',
      (row) => row.discounts?.studentDiscount?.attachment?.filename,
    ),
    col(
      'discount_prior_insurance',
      'boolean',
      'Prior insurance discount.',
      (row) => row.discounts?.priorInsuranceDiscount,
    ),
    col(
      'new_business_application_filename',
      'string',
      'New Business Application filename.',
      (row) => row.newBusinessApplication?.filename,
    ),
    col(
      'new_business_application_uploaded_at',
      'datetime',
      'When it was uploaded (UTC).',
      (row) => row.newBusinessApplication?.uploadedAt,
    ),
    col(
      'transferred_to_policy_id',
      'id',
      'Policy this one was transferred to.',
      (row) => row.transferredToPolicyId,
    ),
    col(
      'transferred_from_policy_id',
      'id',
      'Policy this one was transferred from.',
      (row) => row.transferredFromPolicyId,
    ),
    col('notes', 'string', 'Policy notes.', (row) => row.notes),
    col(
      'legacy_household_id',
      'id',
      'SmartSuite household id.',
      (row) => row.legacyHouseholdId,
    ),
    col(
      'legacy_deal_id',
      'id',
      'SmartSuite deal id.',
      (row) => row.legacyDealId,
    ),
    ...tenantColumns<PolicyRow>(),
  ],
});
