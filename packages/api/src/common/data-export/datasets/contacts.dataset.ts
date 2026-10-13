import { normalizeContactRole } from '@sfa/shared';
import type { Types } from 'mongoose';
import { Contact } from '../../../contacts/schemas/contact.schema';
import { defineDataset } from '../engine/dataset.types';
import type { MembershipLite } from '../engine/lookups';
import {
  columnsFor,
  primeTenant,
  tenantColumns,
  type TenantFields,
} from './columns';

interface ContactRow extends TenantFields {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: Date;
  deceasedAt?: Date;
  notes?: string;
}

interface ContactJoins {
  memberships: Map<string, MembershipLite[]>;
  primaryOf: Map<string, Types.ObjectId[]>;
}

const col = columnsFor<ContactRow, ContactJoins>();

const membershipsOf = (row: ContactRow, joins: ContactJoins) =>
  joins.memberships.get(String(row._id)) ?? [];

/**
 * Contacts (SmartSuite *Contacts*). **One row per person**, the shape of the
 * legacy table and of David's contact export. A contact can belong to several
 * households (`householdMembers` is many-to-many), so those memberships are
 * aligned lists — `household_ids[i]`, `household_refs[i]` and
 * `household_roles[i]` describe the same membership.
 */
export const contactsDataset = defineDataset<ContactRow, ContactJoins>({
  key: 'contacts',
  label: 'Contacts',
  description:
    'One row per person: name, email, phone, date of birth, and the households they currently belong to.',
  model: Contact.name,
  scope: 'client',
  dateFields: [
    {
      key: 'created',
      label: 'Recorded at',
      path: 'createdAt',
      kind: 'instant',
      isDefault: true,
    },
    {
      key: 'date_of_birth',
      label: 'Date of birth',
      path: 'dateOfBirth',
      kind: 'utcDate',
    },
  ],
  filters: ['branchId'],

  async joins(rows, { lookups }) {
    const ids = rows.map((row) => row._id);
    const [memberships, primaryOf] = await Promise.all([
      lookups.membershipsBy('contactId', ids),
      lookups.householdsByPrimaryContact(ids),
      primeTenant(lookups, rows),
    ]);
    await lookups.households.load([
      ...[...memberships.values()].flat().map((member) => member.householdId),
      ...[...primaryOf.values()].flat(),
    ]);
    return { memberships, primaryOf };
  },

  columns: [
    col('contact_id', 'id', 'Contact record id.', (row) => row._id),
    col('first_name', 'string', 'First name.', (row) => row.firstName),
    col('last_name', 'string', 'Last name.', (row) => row.lastName),
    col('email', 'string', 'Email.', (row) => row.email),
    col('phone', 'string', 'Phone.', (row) => row.phone),
    col('date_of_birth', 'date', 'Date of birth.', (row) => row.dateOfBirth),
    col(
      'deceased_at',
      'date',
      'Date of death, when recorded.',
      (row) => row.deceasedAt,
    ),
    col(
      'household_count',
      'number',
      'Households the person currently belongs to.',
      (row, ctx) => membershipsOf(row, ctx.joins).length,
    ),
    col(
      'household_ids',
      'list',
      'Those households, in membership order.',
      (row, ctx) =>
        membershipsOf(row, ctx.joins).map((member) => member.householdId),
    ),
    col(
      'household_refs',
      'list',
      'Their references, in the same order.',
      (row, ctx) =>
        membershipsOf(row, ctx.joins).map(
          (member) =>
            ctx.lookups.households.get(member.householdId)?.householdRef ?? '',
        ),
    ),
    col(
      'household_names',
      'list',
      'Their names, in the same order.',
      (row, ctx) =>
        membershipsOf(row, ctx.joins).map(
          (member) =>
            ctx.lookups.households.get(member.householdId)?.name ?? '',
        ),
    ),
    col(
      'household_roles',
      'list',
      'The person’s role in each, in the same order.',
      (row, ctx) =>
        membershipsOf(row, ctx.joins).map(
          (member) => normalizeContactRole(member.role) || '',
        ),
    ),
    col(
      'primary_contact_of_household_ids',
      'list',
      'Households this person is the primary contact of.',
      (row, ctx) => ctx.joins.primaryOf.get(String(row._id)),
    ),
    col(
      'primary_contact_of_household_refs',
      'list',
      'Their references.',
      (row, ctx) =>
        (ctx.joins.primaryOf.get(String(row._id)) ?? []).map(
          (id) => ctx.lookups.households.get(id)?.householdRef ?? '',
        ),
    ),
    col('notes', 'string', 'Contact notes.', (row) => row.notes),
    ...tenantColumns<ContactRow>(),
  ],
});
