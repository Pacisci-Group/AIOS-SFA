import { Model } from 'mongoose';
import { AuditTemplate } from '../audit-templates/schemas/audit-template.schema';

/**
 * The post-sale audit checklist catalog (PAC-40).
 *
 * ## Why this is core seed data, not demo data
 *
 * `AuditGenerationService` resolves the titles it computes against the
 * `auditTemplates` collection **by exact name**. A title with no matching
 * active template is skipped. So an agency with an empty or differently-named
 * catalog produces a sold deal with no hand-off items at all — silently, with
 * no error anywhere, because generation is best-effort and post-commit.
 *
 * Until now the only writers were the SmartSuite migration and the demo seed,
 * which means a freshly provisioned tenant had *nothing*. This makes the
 * checklist part of the platform baseline.
 *
 * ## Why these names
 *
 * They are the production vocabulary, taken from the SmartSuite "Deal Audit
 * Items" `Audit Item Name` choice list plus the Home/Landlord variants legacy's
 * `maybeCreateDealAuditItems` synthesises at runtime. They are **not** freely
 * editable: `audit-titles.ts` computes these exact strings, so renaming one
 * here disables that item. Agencies can deactivate a template (`active:
 * false`) or add their own; the ones below are the contract.
 *
 * Two mappings worth knowing, because the form and the checklist use different
 * words for the same thing:
 *   - The form's "Roof Receipt" resolves to `Hail Resistant Roof`.
 *   - The form's "Student Discount" resolves to `Good Student`.
 */
export interface CoreAuditTemplateSpec {
  name: string;
  /**
   * `Common` is load-bearing: `computeRequiredTitles` treats a template as
   * baseline when `alwaysInclude` is true **or** the category is exactly
   * `Common` (case-insensitively). Auto / Home / Landlord gate the
   * policy-type-driven and discount-driven items.
   *
   * `Prior Insurance` exists because of that first rule: PAC-65 made the item
   * conditional, and it could not stay in `Common` and be conditional. It is
   * the one category that is neither baseline nor tied to a policy line — it
   * applies to any line, driven purely by the discount selection.
   */
  category: 'Common' | 'Auto' | 'Home' | 'Landlord' | 'Prior Insurance';
  required: boolean;
  blocking: boolean;
  alwaysInclude: boolean;
  task: string;
}

export const CORE_AUDIT_TEMPLATES: CoreAuditTemplateSpec[] = [
  // --- Common: generated for every sold deal (the baseline set) ---
  {
    name: 'Correct Sold Date',
    category: 'Common',
    required: true,
    blocking: true,
    alwaysInclude: true,
    task: 'Verify the sold date on the deal matches the signed application.',
  },
  {
    name: 'Correct Effective Date',
    category: 'Common',
    required: true,
    blocking: true,
    alwaysInclude: true,
    task: 'Verify each policy effective date matches what was bound.',
  },
  /*
   * ⚠ **Not baseline, unlike its neighbours** (PAC-65 #15). Generated only when
   * the producer ticks "prior insurance" on the discounts card.
   *
   * Note it takes **two** changes to leave the baseline, not one:
   * `isBaselineTemplate` matches `alwaysInclude === true` **or** a category of
   * exactly `Common`, so the category has to move as well. Setting only
   * `alwaysInclude: false` here would look correct and change nothing.
   */
  {
    name: 'Prior Insurance',
    category: 'Prior Insurance',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Obtain the declarations page proving continuous prior coverage.',
  },
  {
    name: 'Accord Cancellation',
    category: 'Common',
    required: true,
    blocking: false,
    alwaysInclude: true,
    task: 'Send the ACORD cancellation form to the prior carrier.',
  },
  {
    name: 'Quote Recap',
    category: 'Common',
    required: true,
    blocking: false,
    alwaysInclude: true,
    task: 'Confirm a quote recap exists and matches the sold coverage.',
  },
  {
    name: 'Lead Manager',
    category: 'Common',
    required: false,
    blocking: false,
    alwaysInclude: true,
    task: 'Confirm the lead record is closed out and attributed correctly.',
  },
  {
    name: 'Evidence of Insurance',
    category: 'Common',
    required: true,
    blocking: false,
    alwaysInclude: true,
    task: 'Issue evidence of insurance to the client and any interested party.',
  },

  // --- Auto: policy-type driven (`Drivers Verified`) + discount-driven ---
  {
    name: 'Drivers Verified',
    category: 'Auto',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Verify every listed driver and excluded driver on the auto policy.',
  },
  {
    name: 'Defensive Driver',
    category: 'Auto',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Collect the defensive-driver certificate for the named driver.',
  },
  {
    name: 'Good Student',
    category: 'Auto',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Collect the report card or transcript supporting the discount.',
  },

  // --- Home: policy-type driven (Inspection, Mortgagee) + discount-driven ---
  {
    name: 'Home Inspection',
    category: 'Home',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Confirm the home inspection passed or was waived.',
  },
  {
    name: 'Home Mortgagee',
    category: 'Home',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Verify the mortgagee clause, loan number and escrow billing details.',
  },
  {
    name: 'Home Fire Subscription',
    category: 'Home',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Collect proof of the fire-subscription service for the discount.',
  },
  {
    name: 'Home Actual Cash Value',
    category: 'Home',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Obtain the signed actual-cash-value acknowledgement.',
  },
  {
    name: 'Home Hail Resistant Roof',
    category: 'Home',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Collect the roof receipt or inspection proving hail resistance.',
  },

  // --- Landlord: the same five, for a landlord line ---
  {
    name: 'Landlord Inspection',
    category: 'Landlord',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Confirm the landlord property inspection passed or was waived.',
  },
  {
    name: 'Landlord Mortgagee',
    category: 'Landlord',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Verify the mortgagee clause, loan number and escrow billing details.',
  },
  {
    name: 'Landlord Fire Subscription',
    category: 'Landlord',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Collect proof of the fire-subscription service for the discount.',
  },
  {
    name: 'Landlord Actual Cash Value',
    category: 'Landlord',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Obtain the signed actual-cash-value acknowledgement.',
  },
  {
    name: 'Landlord Hail Resistant Roof',
    category: 'Landlord',
    required: true,
    blocking: false,
    alwaysInclude: false,
    task: 'Collect the roof receipt or inspection proving hail resistance.',
  },
];

/**
 * Upsert the catalog for one agency. Idempotent and safe to re-run.
 *
 * Keyed on `{ agencyId, name }` — the same key the generator resolves by. Note
 * this deliberately does **not** reset `active`: an agency that switched a
 * template off has made a decision, and a re-seed must not silently re-enable
 * it. Everything else (category, flags, task text) is corrected on each run so
 * a vocabulary fix propagates.
 */
export async function seedAuditTemplates(
  auditTemplateModel: Model<AuditTemplate>,
  agencyId: string,
  branchId: string,
): Promise<{ created: number; refreshed: number }> {
  let created = 0;
  let refreshed = 0;

  for (const template of CORE_AUDIT_TEMPLATES) {
    const result = await auditTemplateModel.updateOne(
      { agencyId, name: template.name },
      {
        $set: {
          category: template.category,
          required: template.required,
          blocking: template.blocking,
          alwaysInclude: template.alwaysInclude,
          task: template.task,
        },
        $setOnInsert: {
          agencyId,
          branchId,
          name: template.name,
          // Only on insert — see the note above about not re-enabling.
          active: true,
        },
      },
      { upsert: true },
    );

    // `modifiedCount` cannot distinguish a real change from a no-op here:
    // `timestamps: true` makes Mongoose add `updatedAt` to every `$set`, so an
    // unchanged template still reports as modified. Counting inserts vs.
    // everything-else is the distinction that is actually true.
    if (result.upsertedCount > 0) created += 1;
    else refreshed += 1;
  }

  return { created, refreshed };
}
