import { z } from "zod";
import type {
  MailerAssignmentMode,
  MailerCampaign,
  MailerCampaignDefaults,
  MailerCampaignSettings,
  MailerDiscountRules,
} from "@sfa/shared";
import { numericString } from "@/lib/zod-helpers";

/**
 * The Run a campaign wizard's form state (PAC-71).
 *
 * Mirrors `createCampaignSchema` on the API, but in the shapes a form actually
 * holds: numbers stay **strings** (see `numericString` — coercing turns an
 * untouched `""` into `0`, and a `premiumFloor` of 0 is a run with no floor at
 * all on ~20,000 mail pieces), the `marketPhones` record is an array of rows,
 * and the recipient list is one textarea. {@link toCampaignSettings} is the
 * single conversion boundary.
 *
 * ## The year and the week are the campaign's identity
 *
 * They are the only two things an operator names a run with, and both are
 * numbers. The display name, the printed `Week_Number-NN` and the `FileName`
 * column are all *derived* from that pair ({@link toCampaignName},
 * {@link toCampaignNumber}, {@link toCampaignFileName}) rather than typed a
 * second time — three fields saying the same week is how a file goes to print
 * stamped with a different one.
 *
 * The year is also the year the transform prices against (`settings.runYear`),
 * which is why there is no second control for it: a run whose week says 37 and
 * whose pricing says 2019 is not a state worth being able to reach.
 *
 * ## ⚠ Discount rates are percentages here and fractions on the wire
 *
 * The API stores `0.44`; David talks in "44% off", and a form that asks for
 * `0.44` is one somebody eventually types `44` into and mails 20,000 pieces
 * priced at nothing. The conversion happens in {@link toCampaignSettings} /
 * {@link toFormSettings} and nowhere else.
 */

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export interface MarketPhoneRow {
  market: string;
  phone: string;
}

export interface SquareFootageRow {
  minSquareFeet: string;
  /** Percent, e.g. `"44"`. Sent as `0.44`. */
  ratePercent: string;
}

export interface CampaignFormValues {
  /** Four digits, e.g. `"2026"`. Also the run year the transform prices with. */
  campaignYear: string;
  /** Week of the year, 1–53. Sent as `Week_Number-NN`. */
  campaignWeek: string;
  assignment: {
    mode: MailerAssignmentMode;
    agencyIds: string[];
  };
  settings: {
    premiumFloor: string;
    /** The `FileName` column. Prefilled from the year and week; still editable. */
    fileName: string;
    defaultMarket: string;
    defaultPhone: string;
    marketPhones: MarketPhoneRow[];
    squareFootage: SquareFootageRow[];
    homeAge: {
      maxNewYears: string;
      newRatePercent: string;
      oldRatePercent: string;
    };
    /** One address per line, or comma separated. Split by {@link parseRecipients}. */
    outputRecipients: string;
  };
}

/**
 * A blank form.
 *
 * Only ever on screen for the instant before `GET …/defaults` resolves — the
 * wizard renders a skeleton until then, precisely so nobody can start typing
 * into a floor of `""` and submit it. Declared anyway because `useAppForm` and
 * every `withForm` component need a value-shaped default to type against.
 */
export const EMPTY_CAMPAIGN_FORM: CampaignFormValues = {
  campaignYear: String(new Date().getFullYear()),
  campaignWeek: "",
  assignment: { mode: "carrier_agency_id", agencyIds: [] },
  settings: {
    premiumFloor: "",
    fileName: "",
    defaultMarket: "",
    defaultPhone: "",
    marketPhones: [],
    squareFootage: [],
    homeAge: { maxNewYears: "", newRatePercent: "", oldRatePercent: "" },
    outputRecipients: "",
  },
};

export const emptyMarketPhone = (): MarketPhoneRow => ({
  market: "",
  phone: "",
});

export const emptySquareFootageBand = (): SquareFootageRow => ({
  minSquareFeet: "",
  ratePercent: "",
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EMAIL_SPLIT = /[\s,;]+/;

/** Split a textarea of addresses; blank lines and stray separators vanish. */
export function parseRecipients(raw: string): string[] {
  return raw
    .split(EMAIL_SPLIT)
    .map((value) => value.trim())
    .filter(Boolean);
}

const percent = (label: string) =>
  numericString({
    required: `Enter ${label}`,
    min: 0,
    max: 100,
    tooSmall: "A discount cannot be negative",
    tooLarge: "A discount cannot exceed 100%",
  });

export const campaignFormSchema = z.object({
  campaignYear: numericString({
    required: "Enter the campaign year",
    min: 2000,
    max: 2100,
    tooSmall: "Before 2000 is not a campaign year",
    tooLarge: "After 2100 is not a campaign year",
    integer: "Whole years only",
  }),
  // 53, not 52: an ISO year with 53 weeks is not rare — 2026 is one — and a
  // rule that refuses the last week of the year would refuse it in December,
  // which is exactly when nobody can wait for a fix.
  campaignWeek: numericString({
    required: "Enter the campaign week",
    min: 1,
    max: 53,
    tooSmall: "Weeks start at 1",
    tooLarge: "A year has at most 53 weeks",
    integer: "Whole weeks only",
  }),
  assignment: z
    .object({
      mode: z.enum(["carrier_agency_id", "agencies", "all"]),
      agencyIds: z.array(z.string()),
    })
    // The one mode where an empty list is a mistake rather than the norm — the
    // same rule the API's discriminated union expresses, restated here so it is
    // a field error rather than a 400 after the file has already uploaded.
    .refine(
      (value) => value.mode !== "agencies" || value.agencyIds.length > 0,
      { message: "Choose at least one agency", path: ["agencyIds"] },
    ),
  settings: z.object({
    premiumFloor: numericString({
      required: "Enter the premium floor",
      min: 0,
      max: 1_000_000,
      tooSmall: "A floor cannot be negative",
      tooLarge: "That floor is implausibly high",
    }),
    fileName: z
      .string()
      .trim()
      .min(1, "Enter the file name written to every row")
      .max(120, "That file name is too long"),
    defaultMarket: z
      .string()
      .trim()
      .min(1, "Enter the market used when a ZIP is unmapped")
      .max(60, "That market name is too long"),
    defaultPhone: z
      .string()
      .trim()
      .min(1, "Enter the fallback phone number")
      .max(40, "That phone number is too long"),
    marketPhones: z.array(
      z.object({
        market: z
          .string()
          .trim()
          .min(1, "Name the market")
          .max(60, "That market name is too long"),
        phone: z
          .string()
          .trim()
          .min(1, "Enter a phone number")
          .max(40, "That phone number is too long"),
      }),
    ),
    squareFootage: z
      .array(
        z.object({
          minSquareFeet: numericString({
            required: "Enter the band's floor",
            min: 0,
            max: 100_000,
            tooSmall: "Square footage cannot be negative",
            tooLarge: "That is not a house",
            integer: "Whole square feet only",
          }),
          ratePercent: percent("the discount"),
        }),
      )
      .min(1, "Keep at least one square-footage band"),
    homeAge: z.object({
      maxNewYears: numericString({
        required: "Enter the age cutoff",
        min: 0,
        max: 200,
        tooSmall: "An age cannot be negative",
        tooLarge: "That cutoff is implausibly high",
        integer: "Whole years only",
      }),
      newRatePercent: percent("the newer-home discount"),
      oldRatePercent: percent("the older-home discount"),
    }),
    outputRecipients: z
      .string()
      .refine(
        (raw) => parseRecipients(raw).every((value) => z.email().safeParse(value).success),
        "One of those is not an email address",
      )
      .refine(
        (raw) => parseRecipients(raw).length <= 20,
        "At most 20 recipients",
      ),
  }),
});

// ---------------------------------------------------------------------------
// Derived identity — everything printed comes from the year and the week
// ---------------------------------------------------------------------------

/** The prefix Apex's own output files carry. */
const FILE_NAME_PREFIX = "SFA-RTP";

/**
 * A number field's string, normalized: `" 07 "` → `"7"`.
 *
 * Every derived value goes through this, so the week is written the same way in
 * the name, the campaign number and the file name. Non-numeric text passes
 * through untouched — the field is mid-edit and the schema will refuse it at
 * blur; mangling it into `NaN` on the way would only hide what was typed.
 */
function digits(value: string): string {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  return trimmed && Number.isFinite(parsed) ? String(parsed) : trimmed;
}

/** `"2026"`, `"37"` → `2026 Week 37` — the campaign's display name. */
export function toCampaignName(year: string, week: string): string {
  const y = digits(year);
  const w = digits(week);
  if (!y || !w) return "";
  return `${y} Week ${w}`;
}

/** `"37"` → `Week_Number-37`, the form the API normalizes to and prints. */
export function toCampaignNumber(week: string): string {
  const w = digits(week);
  return w ? `Week_Number-${w}` : "";
}

/** `"2026"`, `"37"` → `SFA-RTP-2026-37`, written to every row's `FileName`. */
export function toCampaignFileName(year: string, week: string): string {
  const y = digits(year);
  const w = digits(week);
  if (!y || !w) return "";
  return `${FILE_NAME_PREFIX}-${y}-${w}`;
}

/**
 * Is this file name one we generated, rather than one somebody typed?
 *
 * The wizard keeps the `FileName` column in step with the week while the
 * operator has not overridden it, and this is how it tells the two apart — an
 * `SFA-QBP` inherited from a past run, or anything hand-written, is left alone.
 */
export function isGeneratedFileName(value: string): boolean {
  return /^SFA-RTP-\d+-\d+$/i.test(value.trim());
}

/** `Week_Number-37` → `"37"`. Anything else (or nothing) → `""`. */
export function weekNumberOf(campaignNumber: string | null | undefined): string {
  const match = /^Week_Number-(\d+)$/i.exec(campaignNumber?.trim() ?? "");
  return match ? digits(match[1]) : "";
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/** `0.44` → `"44"`, without `44.00000000000001`. */
function toPercent(rate: number): string {
  return String(Math.round(rate * 10_000) / 100);
}

/** `"44"` → `0.44`, without `0.44000000000000006`. */
function toRate(percentValue: string): number {
  return Math.round(Number(percentValue) * 100) / 10_000;
}

/** Turn what the form holds into the settings snapshot the API stores. */
export function toCampaignSettings(
  values: CampaignFormValues,
): MailerCampaignSettings {
  const s = values.settings;
  return {
    premiumFloor: Number(s.premiumFloor),
    fileName: s.fileName.trim(),
    defaultMarket: s.defaultMarket.trim(),
    defaultPhone: s.defaultPhone.trim(),
    // The campaign year *is* the run year — one field, so a run cannot be filed
    // under week 37 of 2026 while pricing every home as if it were 2019.
    runYear: Number(values.campaignYear),
    marketPhones: Object.fromEntries(
      s.marketPhones
        .filter((row) => row.market.trim() && row.phone.trim())
        .map((row) => [row.market.trim(), row.phone.trim()]),
    ),
    discounts: {
      // Largest band first, which is the order the processor evaluates in.
      // Sorting here rather than trusting the operator's row order means a band
      // typed out of sequence prices the same as one typed in it.
      squareFootage: s.squareFootage
        .map((row) => ({
          minSquareFeet: Number(row.minSquareFeet),
          rate: toRate(row.ratePercent),
        }))
        .sort((a, b) => b.minSquareFeet - a.minSquareFeet),
      homeAge: {
        maxNewYears: Number(s.homeAge.maxNewYears),
        newRate: toRate(s.homeAge.newRatePercent),
        oldRate: toRate(s.homeAge.oldRatePercent),
      },
    },
    // Never sent from the form: the operator resolves unmapped ZIPs in the
    // preview, and `UnmatchedZipsResolver` PATCHes them on their own.
    zipResolutions: {},
    outputRecipients: parseRecipients(s.outputRecipients),
  };
}

function toFormDiscounts(discounts: MailerDiscountRules) {
  return {
    squareFootage: discounts.squareFootage.map((band) => ({
      minSquareFeet: String(band.minSquareFeet),
      ratePercent: toPercent(band.rate),
    })),
    homeAge: {
      maxNewYears: String(discounts.homeAge.maxNewYears),
      newRatePercent: toPercent(discounts.homeAge.newRate),
      oldRatePercent: toPercent(discounts.homeAge.oldRate),
    },
  };
}

/** The stored settings, back in the shapes the form holds. */
export function toFormSettings(
  settings: MailerCampaignSettings,
): CampaignFormValues["settings"] {
  return {
    premiumFloor: String(settings.premiumFloor),
    fileName: settings.fileName,
    defaultMarket: settings.defaultMarket,
    defaultPhone: settings.defaultPhone,
    marketPhones: Object.entries(settings.marketPhones).map(
      ([market, phone]) => ({ market, phone }),
    ),
    ...toFormDiscounts(settings.discounts),
    // One per line: five addresses read better stacked than wrapped, and
    // pasting a comma-separated block still parses.
    outputRecipients: settings.outputRecipients.join("\n"),
  };
}

/**
 * Prefill the wizard from `GET /platform/mailer-campaigns/defaults`.
 *
 * The year and week come back as *now* — the API is deliberate about that, and
 * re-running a past week is a deliberate act of editing them.
 *
 * ⚠ The `FileName` column is **not** the one inherited with the rest of the
 * settings. Those are the last imported run's, and its file name named that
 * week; carried forward it would stamp this week's 20,000 pieces with the last
 * one's number. It is generated from the week instead, and stays in step with
 * it until somebody types their own — see {@link isGeneratedFileName}.
 */
export function fromDefaults(
  defaults: MailerCampaignDefaults,
): CampaignFormValues {
  const campaignYear = String(defaults.settings.runYear);
  const campaignWeek = weekNumberOf(defaults.campaignNumber);
  return {
    campaignYear,
    campaignWeek,
    assignment: {
      mode: defaults.assignment.mode,
      agencyIds: defaults.assignment.agencyIds,
    },
    settings: {
      ...toFormSettings(defaults.settings),
      fileName: toCampaignFileName(campaignYear, campaignWeek),
    },
  };
}

/**
 * Prefill the wizard from a campaign that already exists.
 *
 * The counterpart to {@link fromDefaults}, for editing a run rather than
 * starting one: an operator re-opening a previewed campaign must see what it is
 * actually about to run with, not the platform defaults it was seeded from
 * three edits ago.
 *
 * `settings` is present on anything the API will accept a `PATCH` for — the
 * create endpoint requires a complete snapshot — so the fallback only keeps the
 * type total; it is not a state the wizard reaches.
 */
export function fromCampaign(campaign: MailerCampaign): CampaignFormValues {
  return {
    // `year` is what the run priced against — the same number `settings.runYear`
    // holds, which is what the create endpoint stored it from.
    campaignYear: String(
      campaign.year ?? campaign.settings?.runYear ?? new Date().getFullYear(),
    ),
    campaignWeek:
      campaign.weekNumber != null
        ? String(campaign.weekNumber)
        : weekNumberOf(campaign.campaignNumber),
    assignment: {
      mode: campaign.assignment.mode,
      agencyIds: campaign.assignment.agencyIds,
    },
    // The stored file name, never a regenerated one: this is what the run
    // actually stamped its rows with.
    settings: campaign.settings
      ? toFormSettings(campaign.settings)
      : EMPTY_CAMPAIGN_FORM.settings,
  };
}
