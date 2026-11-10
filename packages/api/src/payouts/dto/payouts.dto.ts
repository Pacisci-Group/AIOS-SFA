import {
  agencyTiersError,
  amountError,
  basePayError,
  bonusTiersError,
  chargebackWindowError,
  complianceFloorError,
  hatTrickError,
  leadSourceRulesError,
  MAX_BONUS_TIERS,
  MAX_OVERRIDE_RULES,
  MAX_RATE_STEPS,
  MAX_STIPEND_MONTHS,
  memberStartsError,
  OVERRIDE_BASES,
  overridesError,
  producerOfYearError,
  RATE_STEP_BASES,
  referralRuleError,
  statementEnteredAdjustmentsError,
  statementInputsError,
  stipendError,
  teamRequirementsError,
  MAX_PAY_STATEMENTS_PAGE_SIZE,
  MAX_PAYOUT_IMPORT_FILE_BYTES,
  MAX_RATE_RULES,
  PAY_STATEMENT_STATUSES,
  PAY_STATEMENTS_PAGE_SIZE,
  PAYMENT_STRUCTURE_NAME_MAX_LENGTH,
  PAYOUT_MONTH_PATTERN,
  rateRulesError,
  teamBonusError,
} from '@sfa/shared';
import { z } from 'zod';
import { objectId } from '../../common/dashboard/dashboard-filter-query.dto';

/**
 * Request bodies for `/payouts/settings` and `/payouts/structures` (PAC-177).
 *
 * The shapes are checked here; the *rules* — rates 0–100, one rate per
 * carrier, a minimum bundle rate above 0%, one lead-source rate per source and
 * carrier, distinct tier and team-level thresholds (rising pay unless they
 * stack), a 100% team split, two decimals on every amount — are the shared
 * validators the web form runs too, attached as issues on the field they
 * belong to. One set of rules, so the page and the API cannot
 * disagree about what is valid.
 *
 * Numbers are numbers, never coerced strings: `z.coerce` would wave through
 * `""` as `0`, and a pay rate of 0% saved by accident is the worst kind of
 * silent.
 */

const money = z.number({ message: 'Enter an amount.' });
const percent = z.number({ message: 'Enter a percentage.' });

const teamBonusLevelSchema = z
  .object({ thresholdPremium: money, poolAmount: money })
  .strict();

export const teamBonusSchema = z
  .object({
    enabled: z.boolean(),
    stackable: z.boolean(),
    levels: z.array(teamBonusLevelSchema).max(MAX_BONUS_TIERS),
    csrSharePercent: percent,
    producerSharePercent: percent,
  })
  .strict()
  .superRefine((value, ctx) => {
    const error = teamBonusError(value);
    if (error) ctx.addIssue({ code: 'custom', message: error });
  });

export const salespersonOfMonthSchema = z
  .object({ enabled: z.boolean(), bonusAmount: money })
  .strict()
  .superRefine((value, ctx) => {
    const error = amountError(value.bonusAmount, 'The bonus');
    if (error) ctx.addIssue({ code: 'custom', message: error });
  });

export const producerOfYearSchema = z
  .object({
    enabled: z.boolean(),
    bonusAmount: money,
    minCompliantMonths: z.number({ message: 'Enter a number of months.' }),
    minCompliancePercent: percent,
  })
  .strict()
  .superRefine((value, ctx) => {
    const error = producerOfYearError(value);
    if (error) ctx.addIssue({ code: 'custom', message: error });
  });

/**
 * `PATCH /payouts/settings`. Any section may be sent alone, but a section
 * that is sent is sent whole — a half-written team bonus (a new pool with the
 * old split) is exactly the inconsistency the 100% check exists to stop.
 */
export const updatePayoutSettingsSchema = z
  .object({
    teamBonus: teamBonusSchema.optional(),
    salespersonOfMonth: salespersonOfMonthSchema.optional(),
    producerOfYear: producerOfYearSchema.optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.teamBonus !== undefined ||
      body.salespersonOfMonth !== undefined ||
      body.producerOfYear !== undefined,
    {
      message:
        'Send teamBonus, salespersonOfMonth, producerOfYear, or any of them.',
    },
  );
export type UpdatePayoutSettingsDto = z.infer<
  typeof updatePayoutSettingsSchema
>;

/** A gate or setting that is off as `null` (or left out). */
const optionalPercent = percent.nullable().default(null);

const rateStepSchema = z
  .object({
    threshold: z.number({ message: 'Enter a threshold.' }),
    ratePercent: percent,
    bonusAmount: money.default(0),
    minCompliancePercent: optionalPercent,
    minBundleRatePercent: optionalPercent,
  })
  .strict();

const rateRuleSchema = z
  .object({
    carrier: z.string().trim().max(120),
    ratePercent: percent,
    // `null` (or left out) when no minimum bundle rate is enforced.
    minBundleRatePercent: optionalPercent,
    // Left out: a flat rate.
    stepBasis: z.enum(RATE_STEP_BASES).default('premium'),
    steps: z.array(rateStepSchema).max(MAX_RATE_STEPS).default([]),
  })
  .strict();

/**
 * A lead-source override. That the id names a source this agency may use is
 * the service's check — it needs the database; the shape and the rules are
 * here.
 */
const leadSourceRuleSchema = z
  .object({
    leadSourceId: objectId,
    carrier: z.string().trim().max(120),
    ratePercent: percent,
  })
  .strict();

const hatTrickSchema = z
  .object({
    enabled: z.boolean(),
    dealsPerDay: z.number({ message: 'Enter a number of sales.' }),
    bonusAmount: money,
  })
  .strict();

const bonusTierSchema = z
  .object({
    thresholdPremium: money,
    bonusAmount: money,
    minCompliancePercent: optionalPercent,
  })
  .strict();

const plainTierSchema = z
  .object({ thresholdPremium: money, bonusAmount: money })
  .strict();

const overrideSchema = z
  .object({
    basis: z.enum(OVERRIDE_BASES),
    leadSourceId: objectId.nullable().default(null),
    carrier: z.string().trim().max(120),
    ratePercent: percent,
  })
  .strict();

const wholeNumber = (message: string) => z.number({ message });

const structureFields = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Give the structure a name.')
      .max(
        PAYMENT_STRUCTURE_NAME_MAX_LENGTH,
        `A name is at most ${PAYMENT_STRUCTURE_NAME_MAX_LENGTH} characters.`,
      ),
    rules: z.array(rateRuleSchema).max(MAX_RATE_RULES),
    // Required, `[]` for none: the body is the whole structure, and a client
    // that left the field out must not silently clear the overrides.
    leadSourceRules: z.array(leadSourceRuleSchema).max(MAX_RATE_RULES),
    hatTrick: hatTrickSchema,
    individualTiers: z.array(bonusTierSchema).max(MAX_BONUS_TIERS),
    tiersStackable: z.boolean(),
    teamBonusEligible: z.boolean(),
    memberIds: z.array(objectId).max(500),
    // The 2026 comp-plan parts (6 Nov 2026): each optional, left out = none.
    basePay: money.default(0),
    stipendAmounts: z.array(money).max(MAX_STIPEND_MONTHS).default([]),
    memberStarts: z
      .array(
        z
          .object({
            userId: objectId,
            startMonth: z.string().trim(),
          })
          .strict(),
      )
      .max(500)
      .default([]),
    complianceFloor: z
      .object({ minimumPercent: percent, reductionPercent: percent })
      .strict()
      .nullable()
      .default(null),
    overrides: z.array(overrideSchema).max(MAX_OVERRIDE_RULES).default([]),
    agencyTiers: z.array(plainTierSchema).max(MAX_BONUS_TIERS).default([]),
    agencyTiersCarrier: z.string().trim().min(1).max(120).default('*'),
    teamRequirements: z
      .object({
        soldLogWithinDays: wholeNumber('Enter a number of days.').nullable(),
        meetingAttendance: z.boolean(),
      })
      .strict()
      .default({ soldLogWithinDays: null, meetingAttendance: false }),
    referralRule: z
      .object({
        minimum: wholeNumber('Enter a number of referrals.'),
        shortfallDeduction: money,
        bonusThreshold: wholeNumber('Enter a number of referrals.').nullable(),
        bonusAmount: money,
      })
      .strict()
      .nullable()
      .default(null),
    chargebackWindowMonths: wholeNumber('Enter a number of months.')
      .nullable()
      .default(null),
  })
  .strict();

/** The cross-field rules, shared by the create and update bodies. */
function refineStructure(
  value: z.infer<typeof structureFields>,
  ctx: z.RefinementCtx,
): void {
  const rules = rateRulesError(value.rules);
  if (rules) ctx.addIssue({ code: 'custom', path: ['rules'], message: rules });
  const leadSourceRules = leadSourceRulesError(value.leadSourceRules);
  if (leadSourceRules) {
    ctx.addIssue({
      code: 'custom',
      path: ['leadSourceRules'],
      message: leadSourceRules,
    });
  }
  const hatTrick = hatTrickError(value.hatTrick);
  if (hatTrick) {
    ctx.addIssue({ code: 'custom', path: ['hatTrick'], message: hatTrick });
  }
  const tiers = bonusTiersError(value.individualTiers, {
    stackable: value.tiersStackable,
  });
  if (tiers) {
    ctx.addIssue({
      code: 'custom',
      path: ['individualTiers'],
      message: tiers,
    });
  }
  const plan: [string, string | null][] = [
    ['basePay', basePayError(value.basePay)],
    ['stipendAmounts', stipendError(value.stipendAmounts)],
    ['memberStarts', memberStartsError(value.memberStarts)],
    ['complianceFloor', complianceFloorError(value.complianceFloor)],
    ['overrides', overridesError(value.overrides)],
    ['agencyTiers', agencyTiersError(value.agencyTiers)],
    ['teamRequirements', teamRequirementsError(value.teamRequirements)],
    ['referralRule', referralRuleError(value.referralRule)],
    [
      'chargebackWindowMonths',
      chargebackWindowError(value.chargebackWindowMonths),
    ],
  ];
  for (const [path, message] of plan) {
    if (message) ctx.addIssue({ code: 'custom', path: [path], message });
  }
}

/**
 * `POST /payouts/structures` — the whole structure. The form always holds
 * every field, and a whole-object write cannot leave rules and members half
 * from one save and half from another.
 */
export const upsertPaymentStructureSchema =
  structureFields.superRefine(refineStructure);
export type UpsertPaymentStructureDto = z.infer<
  typeof upsertPaymentStructureSchema
>;

/**
 * `PATCH /payouts/structures/:id` — the whole structure, plus the
 * `updatedAt` of the copy it was edited from. Required, not optional: an
 * update that does not say which version it replaces is exactly the silent
 * overwrite the check exists to stop.
 */
export const updatePaymentStructureSchema = structureFields
  .extend({
    expectedUpdatedAt: z.iso.datetime({
      message: 'Send the updatedAt of the structure you edited.',
    }),
  })
  .strict()
  .superRefine(refineStructure);
export type UpdatePaymentStructureDto = z.infer<
  typeof updatePaymentStructureSchema
>;

/** `:id`. */
export const paymentStructureIdSchema = objectId;

// ── Statements (PAC-178 / PAC-179) ──────────────────────────────────────

/** A pay month, `YYYY-MM`. */
export const payoutMonthSchema = z
  .string()
  .trim()
  .regex(PAYOUT_MONTH_PATTERN, 'month must be in YYYY-MM form.');

/** `GET /payouts/runs?month`. */
export const getPayoutRunQuerySchema = z
  .object({ month: payoutMonthSchema })
  .strict();
export type GetPayoutRunQueryDto = z.infer<typeof getPayoutRunQuerySchema>;

/** `POST /payouts/runs` — generate the month, or recalculate it. */
export const generatePayoutRunSchema = z
  .object({ month: payoutMonthSchema })
  .strict();
export type GeneratePayoutRunDto = z.infer<typeof generatePayoutRunSchema>;

/**
 * `GET /payouts/statements`. Every filter narrows what the caller may
 * already see; none widens it. `mine=true` is My Pay: the caller's own
 * statements under the employee rule (never a draft), whatever else they
 * may see.
 */
export const listPayStatementsQuerySchema = z
  .object({
    month: payoutMonthSchema.optional(),
    status: z.enum(PAY_STATEMENT_STATUSES).optional(),
    branchId: objectId.optional(),
    q: z.string().trim().max(100).optional(),
    mine: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAY_STATEMENTS_PAGE_SIZE)
      .default(PAY_STATEMENTS_PAGE_SIZE),
  })
  .strict();
export type ListPayStatementsQueryDto = z.infer<
  typeof listPayStatementsQuerySchema
>;

/** `:id` of a statement. */
export const payStatementIdSchema = objectId;

/** `:id` of a payout run. */
export const payoutRunIdSchema = objectId;

/**
 * `GET /payouts/statements/:id/pdf` — `version` picks an earlier issued
 * version's file; omitted, the current one.
 */
export const payStatementPdfQuerySchema = z
  .object({ version: z.coerce.number().int().min(1).max(1000).optional() })
  .strict();
export type PayStatementPdfQueryDto = z.infer<
  typeof payStatementPdfQuerySchema
>;

/**
 * `POST /payouts/runs/:id/send-all` — `branchId` narrows an agency-wide
 * reviewer to one branch (the branch the Payouts page is filtered to).
 */
export const sendAllDraftsQuerySchema = z
  .object({ branchId: objectId.optional() })
  .strict();
export type SendAllDraftsQueryDto = z.infer<typeof sendAllDraftsQuerySchema>;

/**
 * `PATCH /payouts/statements/:id/inputs` — the figures the manager enters,
 * whole: each `null` when not entered.
 */
export const updateStatementInputsSchema = z
  .object({
    compliancePercent: percent.nullable(),
    retentionPercent: percent.nullable(),
    lifeReferrals: z
      .number({ message: 'Enter a number of referrals.' })
      .nullable(),
    meetingAttendance: z.boolean().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const error = statementInputsError(value);
    if (error) ctx.addIssue({ code: 'custom', message: error });
  });
export type UpdateStatementInputsDto = z.infer<
  typeof updateStatementInputsSchema
>;

/**
 * `PATCH /payouts/statements/:id/adjustments` — the three amounts a reviewer
 * enters (10 Nov 2026), whole: each a positive amount, `null` for none.
 * SPIFFs are added; the compliance adjustment and other adjustments deducted.
 */
export const updateStatementAdjustmentsSchema = z
  .object({
    spiffs: money.nullable(),
    complianceAdjustment: money.nullable(),
    otherAdjustments: money.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const error = statementEnteredAdjustmentsError(value);
    if (error) ctx.addIssue({ code: 'custom', message: error });
  });
export type UpdateStatementAdjustmentsDto = z.infer<
  typeof updateStatementAdjustmentsSchema
>;

/** `GET /payouts/activity` (PAC-179). No `userId` = the caller. */
export const payoutActivityQuerySchema = z
  .object({
    month: payoutMonthSchema,
    userId: objectId.optional(),
  })
  .strict();
export type PayoutActivityQueryDto = z.infer<typeof payoutActivityQuerySchema>;

// ── Chargeback report import (PAC-180) ──────────────────────────────────

/** A report the import reads: a spreadsheet or a CSV export of one. */
const importFilename = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (name) => /\.(xlsx|csv)$/i.test(name),
    'Upload the chargeback report as .xlsx or .csv',
  );

/** `POST /payouts/imports/presign`. */
export const presignChargebackImportSchema = z
  .object({
    filename: importFilename,
    size: z.number().int().min(1).max(MAX_PAYOUT_IMPORT_FILE_BYTES),
  })
  .strict();
export type PresignChargebackImportDto = z.infer<
  typeof presignChargebackImportSchema
>;

/** `POST /payouts/imports` — read the uploaded report into a preview. */
export const createChargebackImportSchema = z
  .object({
    storageKey: z.string().trim().min(1).max(512),
    uploadedFilename: importFilename,
    size: z.number().int().min(1),
    carrier: z.string().trim().min(1, 'Choose a carrier.').max(100),
    month: payoutMonthSchema,
  })
  .strict();
export type CreateChargebackImportDto = z.infer<
  typeof createChargebackImportSchema
>;

/** `GET /payouts/imports?month`. */
export const listChargebackImportsQuerySchema = z
  .object({ month: payoutMonthSchema.optional() })
  .strict();
export type ListChargebackImportsQueryDto = z.infer<
  typeof listChargebackImportsQuerySchema
>;

/** `:id` of an import. */
export const chargebackImportIdSchema = objectId;

/** `:rowNumber` — a line's row in the sheet (a spreadsheet's last row at most). */
export const importRowNumberSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(1_048_576);

/**
 * `PATCH /payouts/imports/:id/rows/:rowNumber`: charge the line to someone,
 * leave it out, or undo the owner's choice. A duplicate takes none — a policy
 * is charged back once.
 */
export const importRowActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), userId: objectId }).strict(),
  z.object({ action: z.literal('skip') }).strict(),
  z.object({ action: z.literal('reset') }).strict(),
]);
export type ImportRowActionDto = z.infer<typeof importRowActionSchema>;
