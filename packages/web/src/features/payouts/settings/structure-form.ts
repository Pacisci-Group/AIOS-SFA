import type { DeepKeys } from "@tanstack/react-form";
import {
  ANY_CARRIER,
  bonusTiersError,
  DEFAULT_HAT_TRICK,
  leadSourceRulesError,
  MAX_HAT_TRICK_DEALS,
  MIN_HAT_TRICK_DEALS,
  PAYMENT_STRUCTURE_NAME_MAX_LENGTH,
  rateRulesError,
  type PaymentStructureView,
  type UpsertPaymentStructureInput,
} from "@sfa/shared";
import { z } from "zod";
import { numericString } from "@/lib/zod-helpers";
import { moneyString, percentString, toField } from "../payout-form-fields";

/**
 * The payment-structure editor's form (PAC-177): one zod schema for all three
 * steps, numbers held as strings and converted in {@link toStructureInput}.
 *
 * The cross-row rules — one rate per carrier, one "any other carrier", one
 * lead-source rate per source and carrier, tiers on distinct thresholds that
 * never pay less as they rise — are the shared validators the API runs,
 * attached to the array they belong to. They only run once every row parses,
 * so a half-typed row shows its own message first.
 */

/*
 * `minBundleRate` is checked only while `bundleEnforced` is ticked — in
 * `superRefine` below, like the hat trick's numbers: unticking hides the
 * field, and a hidden field that still failed would block "Continue".
 */
const rateRowSchema = z.object({
  carrier: z.string().trim().min(1, "Choose a carrier"),
  ratePercent: percentString("Enter a rate"),
  bundleEnforced: z.boolean(),
  minBundleRate: z.string(),
});
const minBundleRateSchema = percentString("Enter a minimum").refine(
  (value) => Number(value) > 0,
  "More than 0%",
);

const leadSourceRowSchema = z.object({
  leadSourceId: z.string().min(1, "Choose a lead source"),
  carrier: z.string().trim().min(1, "Choose a carrier"),
  ratePercent: percentString("Enter a rate"),
});

const tierRowSchema = z.object({
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
    hatTrickEnabled: z.boolean(),
    dealsPerDay: z.string(),
    hatTrickBonus: z.string(),
    tiers: z.array(tierRowSchema),
    tiersStackable: z.boolean(),
    teamBonusEligible: z.boolean(),
    memberIds: z.array(z.string()),
  })
  .superRefine((values, ctx) => {
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
    const rows = values.rules.map((row) => rateRowSchema.safeParse(row));
    if (minimumsValid && rows.every((row) => row.success)) {
      const error = rateRulesError(
        values.rules.map((row) => ({
          carrier: row.carrier,
          ratePercent: Number(row.ratePercent),
          minBundleRatePercent: minBundleRateOf(row),
        })),
      );
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
    const tiers = values.tiers.map((row) => tierRowSchema.safeParse(row));
    if (tiers.every((row) => row.success)) {
      const error = bonusTiersError(
        values.tiers.map((row) => ({
          thresholdPremium: Number(row.thresholdPremium),
          bonusAmount: Number(row.bonusAmount),
        })),
        { stackable: values.tiersStackable },
      );
      if (error) {
        ctx.addIssue({ code: "custom", path: ["tiers"], message: error });
      }
    }
  });

export type StructureFormValues = z.infer<typeof structureFormSchema>;

/** A rate row's minimum bundle rate as sent: the number while ticked, else `null`. */
function minBundleRateOf(row: {
  bundleEnforced: boolean;
  minBundleRate: string;
}): number | null {
  return row.bundleEnforced ? Number(row.minBundleRate) : null;
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
    fields: ["name", "rules", "leadSourceRules"],
  },
  {
    id: "bonuses",
    title: "Bonuses",
    description:
      "Paid on top of commission: a hat trick for a busy day, a tier for a big month, and a share of the team pool.",
    fields: [
      "hatTrickEnabled",
      "dealsPerDay",
      "hatTrickBonus",
      "tiers",
      "tiersStackable",
      "teamBonusEligible",
    ],
  },
  {
    id: "people",
    title: "People",
    description:
      "Who is paid this way. Someone already on another structure moves here when you save.",
    fields: ["memberIds"],
  },
];

export const emptyRateRow = (carrier = "") => ({
  carrier,
  ratePercent: "",
  bundleEnforced: false,
  minBundleRate: "",
});
/** "Any carrier" by default: a source usually pays one rate whatever the carrier. */
export const emptyLeadSourceRow = () => ({
  leadSourceId: "",
  carrier: ANY_CARRIER,
  ratePercent: "",
});
export const emptyTierRow = () => ({ thresholdPremium: "", bonusAmount: "" });

/** A new structure: Allstate and every other carrier to fill in, the default hat trick. */
export function newStructureValues(): StructureFormValues {
  return {
    name: "",
    rules: [emptyRateRow("Allstate"), emptyRateRow(ANY_CARRIER)],
    leadSourceRules: [],
    hatTrickEnabled: DEFAULT_HAT_TRICK.enabled,
    dealsPerDay: String(DEFAULT_HAT_TRICK.dealsPerDay),
    hatTrickBonus: String(DEFAULT_HAT_TRICK.bonusAmount),
    tiers: [],
    tiersStackable: false,
    teamBonusEligible: true,
    memberIds: [],
  };
}

export function structureValuesFrom(
  view: PaymentStructureView,
): StructureFormValues {
  return {
    name: view.name,
    rules: view.rules.map((rule) => ({
      carrier: rule.carrier,
      ratePercent: toField(rule.ratePercent),
      bundleEnforced:
        rule.minBundleRatePercent !== null &&
        rule.minBundleRatePercent !== undefined,
      minBundleRate: toField(rule.minBundleRatePercent),
    })),
    leadSourceRules: view.leadSourceRules.map((rule) => ({
      leadSourceId: rule.leadSourceId,
      carrier: rule.carrier,
      ratePercent: toField(rule.ratePercent),
    })),
    hatTrickEnabled: view.hatTrick.enabled,
    dealsPerDay: toField(view.hatTrick.dealsPerDay),
    hatTrickBonus: toField(view.hatTrick.bonusAmount),
    tiers: view.individualTiers.map((tier) => ({
      thresholdPremium: toField(tier.thresholdPremium),
      bonusAmount: toField(tier.bonusAmount),
    })),
    tiersStackable: view.tiersStackable,
    teamBonusEligible: view.teamBonusEligible,
    memberIds: view.members.map((member) => member.id),
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

export function toStructureInput(
  values: StructureFormValues,
): UpsertPaymentStructureInput {
  return {
    name: values.name.trim(),
    rules: values.rules.map((rule) => ({
      carrier: rule.carrier,
      ratePercent: Number(rule.ratePercent),
      minBundleRatePercent: minBundleRateOf(rule),
    })),
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
    })),
    tiersStackable: values.tiersStackable,
    teamBonusEligible: values.teamBonusEligible,
    memberIds: values.memberIds,
  };
}
