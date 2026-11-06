import type { DeepKeys } from "@tanstack/react-form";
import {
  agencyTiersError,
  ANY_CARRIER,
  basePayError,
  bonusTiersError,
  chargebackWindowError,
  complianceFloorError,
  DEFAULT_HAT_TRICK,
  leadSourceRulesError,
  MAX_CHARGEBACK_WINDOW_MONTHS,
  MAX_HAT_TRICK_DEALS,
  MAX_REFERRAL_COUNT,
  MAX_SOLD_LOG_DAYS,
  memberStartsError,
  MIN_HAT_TRICK_DEALS,
  OVERRIDE_BASES,
  overridesError,
  PAYMENT_STRUCTURE_NAME_MAX_LENGTH,
  PAYOUT_MONTH_PATTERN,
  RATE_STEP_BASES,
  rateRulesError,
  referralRuleError,
  stipendError,
  teamRequirementsError,
  type MemberStart,
  type OverrideRule,
  type PaymentStructureView,
  type RateRule,
  type RateStep,
  type ReferralRule,
  type UpsertPaymentStructureInput,
} from "@sfa/shared";
import { z } from "zod";
import { numericString } from "@/lib/zod-helpers";
import {
  blankNumber,
  blankOr,
  moneyString,
  percentString,
  toField,
  wholeString,
} from "../payout-form-fields";

/**
 * The payment-structure editor's form (PAC-177): one zod schema for all three
 * steps, numbers held as strings and converted in {@link toStructureInput}.
 *
 * The cross-row rules — one rate per carrier, one "any other carrier", one
 * lead-source rate per source and carrier, tiers on distinct thresholds that
 * never pay less as they rise — are the shared validators the API runs,
 * attached to the array they belong to. They only run once every row parses,
 * so a half-typed row shows its own message first.
 *
 * The 2026 comp-plan parts (stepped rates, overrides, base pay, stipend,
 * agency tiers, the compliance floor, team requirements, referrals, the
 * chargeback window) follow the same rules: a part hidden behind a toggle is
 * checked only while it shows, and the shared validator runs once its own
 * fields parse.
 */

/** A step of a stepped rate. Checked in `superRefine`, only while `stepped`. */
const stepRowSchema = z.object({
  threshold: z.string(),
  ratePercent: z.string(),
  /** Blank = no one-off bonus. */
  bonusAmount: z.string(),
  /** Blank = no gate. */
  minCompliance: z.string(),
  /** Blank = no gate. */
  minBundleRate: z.string(),
});

/*
 * `minBundleRate` is checked only while `bundleEnforced` is ticked — in
 * `superRefine` below, like the hat trick's numbers: unticking hides the
 * field, and a hidden field that still failed would block "Continue". The
 * steps likewise, only while `stepped` is ticked.
 */
const rateRowSchema = z.object({
  carrier: z.string().trim().min(1, "Choose a carrier"),
  ratePercent: percentString("Enter a rate"),
  bundleEnforced: z.boolean(),
  minBundleRate: z.string(),
  stepped: z.boolean(),
  stepBasis: z.enum(RATE_STEP_BASES),
  steps: z.array(stepRowSchema),
});
const minBundleRateSchema = percentString("Enter a minimum").refine(
  (value) => Number(value) > 0,
  "More than 0%",
);

/** A minimum that may be left off: blank, or a percentage above 0%. */
const gateSchema = blankOr(
  percentString("Enter a minimum").refine(
    (value) => Number(value) > 0,
    "More than 0%",
  ),
);
const optionalMoneySchema = blankOr(moneyString("Enter an amount"));

const stepThresholdSchemas = {
  premium: moneyString("Enter a premium").refine(
    (value) => Number(value) > 0,
    "More than $0",
  ),
  retention: percentString("Enter a retention").refine(
    (value) => Number(value) > 0,
    "More than 0%",
  ),
} as const;
const stepRateSchema = percentString("Enter a rate");

const leadSourceRowSchema = z.object({
  leadSourceId: z.string().min(1, "Choose a lead source"),
  carrier: z.string().trim().min(1, "Choose a carrier"),
  ratePercent: percentString("Enter a rate"),
});

/** `leadSourceId` is required only on a lead-source override — in `superRefine`. */
const overrideRowSchema = z.object({
  basis: z.enum(OVERRIDE_BASES),
  leadSourceId: z.string(),
  carrier: z.string().trim().min(1, "Choose a carrier"),
  ratePercent: percentString("Enter a rate"),
});

const tierRowSchema = z.object({
  thresholdPremium: moneyString("Enter a premium").refine(
    (value) => Number(value) > 0,
    "More than $0",
  ),
  bonusAmount: moneyString("Enter a bonus"),
  minCompliance: gateSchema,
});

const agencyTierRowSchema = z.object({
  thresholdPremium: moneyString("Enter a premium").refine(
    (value) => Number(value) > 0,
    "More than $0",
  ),
  bonusAmount: moneyString("Enter a bonus"),
});

/*
 * The hat trick's two numbers are checked only while the hat trick is on —
 * in `superRefine` below, not on the fields. Unticking it hides them, and a
 * hidden field that still failed (a cleared bonus) would block "Continue"
 * with an error nobody can see.
 */
const dealsPerDaySchema = numericString({
  required: "Enter a number of sales",
  min: MIN_HAT_TRICK_DEALS,
  max: MAX_HAT_TRICK_DEALS,
  tooSmall: `At least ${MIN_HAT_TRICK_DEALS}`,
  tooLarge: `At most ${MAX_HAT_TRICK_DEALS}`,
  integer: "Whole sales only",
});
const hatTrickBonusSchema = moneyString("Enter a bonus");

// Hidden behind their toggles, so checked in `superRefine` like the hat trick.
const floorMinimumSchema = percentString("Enter a minimum").refine(
  (value) => Number(value) > 0,
  "More than 0%",
);
const floorReductionSchema = percentString("Enter a reduction");
const soldLogDaysSchema = blankOr(
  wholeString("Enter a number of days", { min: 0, max: MAX_SOLD_LOG_DAYS }),
);
const referralMinimumSchema = wholeString("Enter a minimum", {
  min: 0,
  max: MAX_REFERRAL_COUNT,
});
const referralDeductionSchema = moneyString("Enter a deduction");
const referralThresholdSchema = blankOr(
  wholeString("Enter a number", { min: 1, max: MAX_REFERRAL_COUNT }),
);
const referralBonusSchema = moneyString("Enter a bonus");
// Always shown, so on the fields themselves; the shared rules run in `superRefine`.
const chargebackWindowSchema = blankOr(
  wholeString("Enter a number of months", {
    min: 1,
    max: MAX_CHARGEBACK_WINDOW_MONTHS,
  }),
);
const stipendAmountSchema = moneyString("Enter an amount");

export const structureFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give the structure a name")
      .max(
        PAYMENT_STRUCTURE_NAME_MAX_LENGTH,
        `At most ${PAYMENT_STRUCTURE_NAME_MAX_LENGTH} characters`,
      ),
    rules: z.array(rateRowSchema),
    leadSourceRules: z.array(leadSourceRowSchema),
    overrides: z.array(overrideRowSchema),
    /** Blank = no limit. */
    chargebackWindow: chargebackWindowSchema,
    /** Blank = none. */
    basePay: optionalMoneySchema,
    /** Month 1, 2, … of the stipend. */
    stipendAmounts: z.array(stipendAmountSchema),
    hatTrickEnabled: z.boolean(),
    dealsPerDay: z.string(),
    hatTrickBonus: z.string(),
    tiers: z.array(tierRowSchema),
    tiersStackable: z.boolean(),
    agencyTiersCarrier: z.string().trim().min(1, "Choose a carrier"),
    agencyTiers: z.array(agencyTierRowSchema),
    teamBonusEligible: z.boolean(),
    soldLogDays: z.string(),
    meetingAttendance: z.boolean(),
    referralEnabled: z.boolean(),
    referralMinimum: z.string(),
    referralDeduction: z.string(),
    referralBonusThreshold: z.string(),
    referralBonus: z.string(),
    floorEnabled: z.boolean(),
    floorMinimum: z.string(),
    floorReduction: z.string(),
    memberIds: z.array(z.string()),
    /**
     * Person id → start month (`YYYY-MM`), for the stipend. Kept for people
     * unticked since, so ticking them again brings it back; only members'
     * are sent.
     */
    memberStarts: z.record(z.string(), z.string()),
  })
  .superRefine((values, ctx) => {
    /** `schema`'s issues on `path`; whether there were none. */
    const check = (
      schema: z.ZodType<string>,
      value: string,
      path: (string | number)[],
    ): boolean => {
      const result = schema.safeParse(value);
      for (const issue of result.error?.issues ?? []) {
        ctx.addIssue({ code: "custom", path, message: issue.message });
      }
      return result.success;
    };

    if (values.hatTrickEnabled) {
      for (const [path, schema] of [
        ["dealsPerDay", dealsPerDaySchema],
        ["hatTrickBonus", hatTrickBonusSchema],
      ] as const) {
        const result = schema.safeParse(values[path]);
        for (const issue of result.error?.issues ?? []) {
          ctx.addIssue({
            code: "custom",
            path: [path],
            message: issue.message,
          });
        }
      }
    }
    let minimumsValid = true;
    for (const [index, row] of values.rules.entries()) {
      if (!row.bundleEnforced) continue;
      const result = minBundleRateSchema.safeParse(row.minBundleRate);
      for (const issue of result.error?.issues ?? []) {
        minimumsValid = false;
        ctx.addIssue({
          code: "custom",
          path: ["rules", index, "minBundleRate"],
          message: issue.message,
        });
      }
    }
    let stepsValid = true;
    for (const [index, row] of values.rules.entries()) {
      if (!row.stepped) continue;
      for (const [step, value] of row.steps.entries()) {
        const at = (key: keyof typeof value) => [
          "rules",
          index,
          "steps",
          step,
          key,
        ];
        const fine = [
          check(
            stepThresholdSchemas[row.stepBasis],
            value.threshold,
            at("threshold"),
          ),
          check(stepRateSchema, value.ratePercent, at("ratePercent")),
          check(optionalMoneySchema, value.bonusAmount, at("bonusAmount")),
          check(gateSchema, value.minCompliance, at("minCompliance")),
          check(gateSchema, value.minBundleRate, at("minBundleRate")),
        ];
        if (fine.includes(false)) stepsValid = false;
      }
    }
    const rows = values.rules.map((row) => rateRowSchema.safeParse(row));
    if (minimumsValid && stepsValid && rows.every((row) => row.success)) {
      const rules = values.rules.map(rateRuleOf);
      // A rule's own steps first, on its step list: "a higher step cannot
      // pay a lower rate" belongs beside the steps, not under every rate.
      let stepError = false;
      for (const [index, rule] of rules.entries()) {
        const error = rateRulesError([rule]);
        if (!error) continue;
        stepError = true;
        ctx.addIssue({
          code: "custom",
          path: ["rules", index, "steps"],
          message: error,
        });
      }
      const error = stepError ? null : rateRulesError(rules);
      if (error) {
        ctx.addIssue({ code: "custom", path: ["rules"], message: error });
      }
    }
    const overrides = values.leadSourceRules.map((row) =>
      leadSourceRowSchema.safeParse(row),
    );
    if (overrides.every((row) => row.success)) {
      const error = leadSourceRulesError(
        values.leadSourceRules.map((row) => ({
          leadSourceId: row.leadSourceId,
          carrier: row.carrier,
          ratePercent: Number(row.ratePercent),
        })),
      );
      if (error) {
        ctx.addIssue({
          code: "custom",
          path: ["leadSourceRules"],
          message: error,
        });
      }
    }
    let sourcesChosen = true;
    for (const [index, row] of values.overrides.entries()) {
      if (row.basis !== "lead_source" || row.leadSourceId) continue;
      sourcesChosen = false;
      ctx.addIssue({
        code: "custom",
        path: ["overrides", index, "leadSourceId"],
        message: "Choose a lead source",
      });
    }
    if (
      sourcesChosen &&
      values.overrides.every((row) => overrideRowSchema.safeParse(row).success)
    ) {
      const error = overridesError(values.overrides.map(overrideOf));
      if (error) {
        ctx.addIssue({ code: "custom", path: ["overrides"], message: error });
      }
    }
    if (optionalMoneySchema.safeParse(values.basePay).success) {
      const error = basePayError(blankNumber(values.basePay) ?? 0);
      if (error) {
        ctx.addIssue({ code: "custom", path: ["basePay"], message: error });
      }
    }
    if (
      values.stipendAmounts.every(
        (amount) => stipendAmountSchema.safeParse(amount).success,
      )
    ) {
      const error = stipendError(values.stipendAmounts.map(Number));
      if (error) {
        ctx.addIssue({
          code: "custom",
          path: ["stipendAmounts"],
          message: error,
        });
      }
    }
    const tiers = values.tiers.map((row) => tierRowSchema.safeParse(row));
    if (tiers.every((row) => row.success)) {
      const error = bonusTiersError(
        values.tiers.map((row) => ({
          thresholdPremium: Number(row.thresholdPremium),
          bonusAmount: Number(row.bonusAmount),
          minCompliancePercent: blankNumber(row.minCompliance),
        })),
        { stackable: values.tiersStackable },
      );
      if (error) {
        ctx.addIssue({ code: "custom", path: ["tiers"], message: error });
      }
    }
    if (
      values.agencyTiers.every(
        (row) => agencyTierRowSchema.safeParse(row).success,
      )
    ) {
      const error = agencyTiersError(
        values.agencyTiers.map((row) => ({
          thresholdPremium: Number(row.thresholdPremium),
          bonusAmount: Number(row.bonusAmount),
        })),
      );
      if (error) {
        ctx.addIssue({ code: "custom", path: ["agencyTiers"], message: error });
      }
    }
    if (
      values.teamBonusEligible &&
      check(soldLogDaysSchema, values.soldLogDays, ["soldLogDays"])
    ) {
      const error = teamRequirementsError(teamRequirementsOf(values));
      if (error) {
        ctx.addIssue({ code: "custom", path: ["soldLogDays"], message: error });
      }
    }
    if (values.referralEnabled) {
      const fine = [
        check(referralMinimumSchema, values.referralMinimum, [
          "referralMinimum",
        ]),
        check(referralDeductionSchema, values.referralDeduction, [
          "referralDeduction",
        ]),
        check(referralThresholdSchema, values.referralBonusThreshold, [
          "referralBonusThreshold",
        ]),
        // The bonus is asked for only once there is a threshold to earn it.
        values.referralBonusThreshold.trim() === "" ||
          check(referralBonusSchema, values.referralBonus, ["referralBonus"]),
      ];
      if (!fine.includes(false)) {
        // What the fields cannot see alone: the threshold above the minimum.
        const error = referralRuleError(referralRuleOf(values));
        if (error) {
          ctx.addIssue({
            code: "custom",
            path: ["referralBonusThreshold"],
            message: error,
          });
        }
      }
    }
    if (values.floorEnabled) {
      const fine = [
        check(floorMinimumSchema, values.floorMinimum, ["floorMinimum"]),
        check(floorReductionSchema, values.floorReduction, ["floorReduction"]),
      ];
      if (!fine.includes(false)) {
        const error = complianceFloorError(complianceFloorOf(values));
        if (error) {
          ctx.addIssue({
            code: "custom",
            path: ["floorMinimum"],
            message: error,
          });
        }
      }
    }
    if (chargebackWindowSchema.safeParse(values.chargebackWindow).success) {
      const error = chargebackWindowError(blankNumber(values.chargebackWindow));
      if (error) {
        ctx.addIssue({
          code: "custom",
          path: ["chargebackWindow"],
          message: error,
        });
      }
    }
    const startsError = memberStartsError(memberStartsOf(values));
    if (startsError) {
      ctx.addIssue({
        code: "custom",
        path: ["memberStarts"],
        message: startsError,
      });
    }
  });

export type StructureFormValues = z.infer<typeof structureFormSchema>;
type RateRow = StructureFormValues["rules"][number];
type StepRow = RateRow["steps"][number];
type OverrideRow = StructureFormValues["overrides"][number];

/** A rate row's minimum bundle rate as sent: the number while ticked, else `null`. */
function minBundleRateOf(row: {
  bundleEnforced: boolean;
  minBundleRate: string;
}): number | null {
  return row.bundleEnforced ? Number(row.minBundleRate) : null;
}

function stepOf(row: StepRow): RateStep {
  return {
    threshold: Number(row.threshold),
    ratePercent: Number(row.ratePercent),
    bonusAmount: blankNumber(row.bonusAmount) ?? 0,
    minCompliancePercent: blankNumber(row.minCompliance),
    minBundleRatePercent: blankNumber(row.minBundleRate),
  };
}

/** A rate row as sent: its steps only while "Step up the rate" is ticked. */
function rateRuleOf(row: RateRow): RateRule {
  return {
    carrier: row.carrier,
    ratePercent: Number(row.ratePercent),
    minBundleRatePercent: minBundleRateOf(row),
    stepBasis: row.stepBasis,
    steps: row.stepped ? row.steps.map(stepOf) : [],
  };
}

/** An override as sent: an agency-premium override names no lead source. */
function overrideOf(row: OverrideRow): OverrideRule {
  return {
    basis: row.basis,
    leadSourceId:
      row.basis === "lead_source" && row.leadSourceId ? row.leadSourceId : null,
    carrier: row.carrier,
    ratePercent: Number(row.ratePercent),
  };
}

/**
 * The team requirements as sent. While the team bonus is off the fields are
 * hidden and unchecked, so a day count that does not parse is sent as none —
 * a valid one the owner typed is kept, so ticking the box again brings it
 * back (the hat trick's numbers work the same way).
 */
function teamRequirementsOf(values: StructureFormValues) {
  return {
    soldLogWithinDays: soldLogDaysSchema.safeParse(values.soldLogDays).success
      ? blankNumber(values.soldLogDays)
      : null,
    meetingAttendance: values.meetingAttendance,
  };
}

function referralRuleOf(values: StructureFormValues): ReferralRule | null {
  if (!values.referralEnabled) return null;
  const bonusThreshold = blankNumber(values.referralBonusThreshold);
  return {
    minimum: Number(values.referralMinimum),
    shortfallDeduction: Number(values.referralDeduction),
    bonusThreshold,
    bonusAmount:
      bonusThreshold === null ? 0 : (blankNumber(values.referralBonus) ?? 0),
  };
}

function complianceFloorOf(values: StructureFormValues) {
  return values.floorEnabled
    ? {
        minimumPercent: Number(values.floorMinimum),
        reductionPercent: Number(values.floorReduction),
      }
    : null;
}

/** The ticked members' start months; a member without one is left out. */
function memberStartsOf(values: StructureFormValues): MemberStart[] {
  return values.memberIds.flatMap((userId) => {
    const startMonth = values.memberStarts[userId] ?? "";
    return PAYOUT_MONTH_PATTERN.test(startMonth)
      ? [{ userId, startMonth }]
      : [];
  });
}

export interface StructureStep {
  id: "rates" | "bonuses" | "people";
  title: string;
  description: string;
  /** Path roots this step owns — the onboarding wizard's contract. */
  fields: Array<DeepKeys<StructureFormValues>>;
}

export const STRUCTURE_STEPS: readonly StructureStep[] = [
  {
    id: "rates",
    title: "Commission rates",
    description:
      "The share of sold premium paid for each carrier, and any lead sources paid differently. Chargebacks come off the premium before its rate applies.",
    fields: [
      "name",
      "rules",
      "leadSourceRules",
      "overrides",
      "chargebackWindow",
    ],
  },
  {
    id: "bonuses",
    title: "Pay and bonuses",
    description:
      "Paid on top of commission: base pay and a stipend, a hat trick for a busy day, tiers for a big month, and a share of the team pool. Then the conditions that can hold them back.",
    fields: [
      "basePay",
      "stipendAmounts",
      "hatTrickEnabled",
      "dealsPerDay",
      "hatTrickBonus",
      "tiers",
      "tiersStackable",
      "agencyTiersCarrier",
      "agencyTiers",
      "teamBonusEligible",
      "soldLogDays",
      "meetingAttendance",
      "referralEnabled",
      "referralMinimum",
      "referralDeduction",
      "referralBonusThreshold",
      "referralBonus",
      "floorEnabled",
      "floorMinimum",
      "floorReduction",
    ],
  },
  {
    id: "people",
    title: "People",
    description:
      "Who is paid this way. Someone already on another structure moves here when you save.",
    fields: ["memberIds", "memberStarts"],
  },
];

export const emptyStepRow = (): StepRow => ({
  threshold: "",
  ratePercent: "",
  bonusAmount: "",
  minCompliance: "",
  minBundleRate: "",
});
export const emptyRateRow = (carrier = ""): RateRow => ({
  carrier,
  ratePercent: "",
  bundleEnforced: false,
  minBundleRate: "",
  stepped: false,
  stepBasis: "premium",
  steps: [],
});
/** "Any carrier" by default: a source usually pays one rate whatever the carrier. */
export const emptyLeadSourceRow = () => ({
  leadSourceId: "",
  carrier: ANY_CARRIER,
  ratePercent: "",
});
/** All agency premium on any carrier: the Office Manager's override. */
export const emptyOverrideRow = (): OverrideRow => ({
  basis: "agency",
  leadSourceId: "",
  carrier: ANY_CARRIER,
  ratePercent: "",
});
export const emptyTierRow = () => ({
  thresholdPremium: "",
  bonusAmount: "",
  minCompliance: "",
});
export const emptyAgencyTierRow = () => ({
  thresholdPremium: "",
  bonusAmount: "",
});

/** A new structure: Allstate and every other carrier to fill in, the default hat trick. */
export function newStructureValues(): StructureFormValues {
  return {
    name: "",
    rules: [emptyRateRow("Allstate"), emptyRateRow(ANY_CARRIER)],
    leadSourceRules: [],
    overrides: [],
    chargebackWindow: "",
    basePay: "",
    stipendAmounts: [],
    hatTrickEnabled: DEFAULT_HAT_TRICK.enabled,
    dealsPerDay: String(DEFAULT_HAT_TRICK.dealsPerDay),
    hatTrickBonus: String(DEFAULT_HAT_TRICK.bonusAmount),
    tiers: [],
    tiersStackable: false,
    agencyTiersCarrier: ANY_CARRIER,
    agencyTiers: [],
    teamBonusEligible: true,
    soldLogDays: "",
    meetingAttendance: false,
    referralEnabled: false,
    referralMinimum: "",
    referralDeduction: "",
    referralBonusThreshold: "",
    referralBonus: "",
    floorEnabled: false,
    floorMinimum: "",
    floorReduction: "",
    memberIds: [],
    memberStarts: {},
  };
}

/** `""` for a zero that means "none" (no base pay, no step bonus). */
const noneIfZero = (value: number | null | undefined) =>
  value ? toField(value) : "";

export function structureValuesFrom(
  view: PaymentStructureView,
): StructureFormValues {
  const referral = view.referralRule ?? null;
  const floor = view.complianceFloor ?? null;
  return {
    name: view.name,
    rules: view.rules.map((rule) => ({
      carrier: rule.carrier,
      ratePercent: toField(rule.ratePercent),
      bundleEnforced:
        rule.minBundleRatePercent !== null &&
        rule.minBundleRatePercent !== undefined,
      minBundleRate: toField(rule.minBundleRatePercent),
      stepped: (rule.steps?.length ?? 0) > 0,
      stepBasis: rule.stepBasis ?? "premium",
      steps: (rule.steps ?? []).map((step) => ({
        threshold: toField(step.threshold),
        ratePercent: toField(step.ratePercent),
        bonusAmount: noneIfZero(step.bonusAmount),
        minCompliance: toField(step.minCompliancePercent),
        minBundleRate: toField(step.minBundleRatePercent),
      })),
    })),
    leadSourceRules: view.leadSourceRules.map((rule) => ({
      leadSourceId: rule.leadSourceId,
      carrier: rule.carrier,
      ratePercent: toField(rule.ratePercent),
    })),
    overrides: (view.overrides ?? []).map((rule) => ({
      basis: rule.basis,
      leadSourceId: rule.leadSourceId ?? "",
      carrier: rule.carrier,
      ratePercent: toField(rule.ratePercent),
    })),
    chargebackWindow: toField(view.chargebackWindowMonths),
    basePay: noneIfZero(view.basePay),
    stipendAmounts: (view.stipendAmounts ?? []).map((amount) =>
      toField(amount),
    ),
    hatTrickEnabled: view.hatTrick.enabled,
    dealsPerDay: toField(view.hatTrick.dealsPerDay),
    hatTrickBonus: toField(view.hatTrick.bonusAmount),
    tiers: view.individualTiers.map((tier) => ({
      thresholdPremium: toField(tier.thresholdPremium),
      bonusAmount: toField(tier.bonusAmount),
      minCompliance: toField(tier.minCompliancePercent),
    })),
    tiersStackable: view.tiersStackable,
    agencyTiersCarrier: view.agencyTiersCarrier || ANY_CARRIER,
    agencyTiers: (view.agencyTiers ?? []).map((tier) => ({
      thresholdPremium: toField(tier.thresholdPremium),
      bonusAmount: toField(tier.bonusAmount),
    })),
    teamBonusEligible: view.teamBonusEligible,
    soldLogDays: toField(view.teamRequirements?.soldLogWithinDays),
    meetingAttendance: view.teamRequirements?.meetingAttendance ?? false,
    referralEnabled: referral !== null,
    referralMinimum: toField(referral?.minimum),
    referralDeduction: toField(referral?.shortfallDeduction),
    referralBonusThreshold: toField(referral?.bonusThreshold),
    referralBonus:
      referral?.bonusThreshold === null ? "" : toField(referral?.bonusAmount),
    floorEnabled: floor !== null,
    floorMinimum: toField(floor?.minimumPercent),
    floorReduction: toField(floor?.reductionPercent),
    memberIds: view.members.map((member) => member.id),
    memberStarts: Object.fromEntries(
      (view.memberStarts ?? []).map((start) => [
        start.userId,
        start.startMonth,
      ]),
    ),
  };
}

/**
 * A hat-trick number as sent: what was typed, or — when the hat trick is off
 * and the hidden field is blank or invalid — the default. The API still
 * requires a valid rule either way, and keeping a valid value the owner typed
 * means ticking the box again later brings it back.
 */
function hatTrickNumber(
  values: StructureFormValues,
  raw: string,
  schema: z.ZodType<string>,
  fallback: number,
): number {
  if (values.hatTrickEnabled || schema.safeParse(raw).success) {
    return Number(raw);
  }
  return fallback;
}

/** The whole structure, every comp-plan part included (a part left out would read as "none"). */
export function toStructureInput(
  values: StructureFormValues,
): UpsertPaymentStructureInput {
  return {
    name: values.name.trim(),
    rules: values.rules.map(rateRuleOf),
    leadSourceRules: values.leadSourceRules.map((rule) => ({
      leadSourceId: rule.leadSourceId,
      carrier: rule.carrier,
      ratePercent: Number(rule.ratePercent),
    })),
    hatTrick: {
      enabled: values.hatTrickEnabled,
      dealsPerDay: hatTrickNumber(
        values,
        values.dealsPerDay,
        dealsPerDaySchema,
        DEFAULT_HAT_TRICK.dealsPerDay,
      ),
      bonusAmount: hatTrickNumber(
        values,
        values.hatTrickBonus,
        hatTrickBonusSchema,
        DEFAULT_HAT_TRICK.bonusAmount,
      ),
    },
    individualTiers: values.tiers.map((tier) => ({
      thresholdPremium: Number(tier.thresholdPremium),
      bonusAmount: Number(tier.bonusAmount),
      minCompliancePercent: blankNumber(tier.minCompliance),
    })),
    tiersStackable: values.tiersStackable,
    teamBonusEligible: values.teamBonusEligible,
    memberIds: values.memberIds,
    basePay: blankNumber(values.basePay) ?? 0,
    stipendAmounts: values.stipendAmounts.map(Number),
    memberStarts: memberStartsOf(values),
    complianceFloor: complianceFloorOf(values),
    overrides: values.overrides.map(overrideOf),
    agencyTiers: values.agencyTiers.map((tier) => ({
      thresholdPremium: Number(tier.thresholdPremium),
      bonusAmount: Number(tier.bonusAmount),
    })),
    agencyTiersCarrier: values.agencyTiersCarrier || ANY_CARRIER,
    teamRequirements: teamRequirementsOf(values),
    referralRule: referralRuleOf(values),
    chargebackWindowMonths: blankNumber(values.chargebackWindow),
  };
}
