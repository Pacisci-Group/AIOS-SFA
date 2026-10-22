/**
 * Replace raw SmartSuite Policy Type codes with their labels.
 *
 * ## What was wrong
 *
 * The SmartSuite import asked for hydrated records but read a select's *code*
 * and ignored the label beside it, translating through an alias map built from
 * `docs/smartsuite-tables/The Policies Table.md` — which lists six of the
 * field's thirteen choices. The other seven were stored as the code itself, so
 * a policy reads `BK08B` where it should read a policy type.
 *
 * The import has since been fixed (`resolvePolicyType` falls back to the
 * hydrated label) and the read path normalizes a stored code
 * (`normalizePolicyType` in `@sfa/shared`), so the app displays these
 * correctly. The stored value is still a code, though — which is what anyone
 * reading the database, an export or a raw aggregation sees. This is the one
 * pass over what is already stored.
 *
 * ## What this does
 *
 * Rewrites the code to its label in the three places the Policies code set
 * reaches:
 *
 * - `policies.policyType` — the field the codes belong to.
 * - `deals.policyTypes[]` — the import rolls a deal's policies up into it.
 * - `serviceTickets.policyType` — a display copy taken from the linked policy
 *   when the ticket was created.
 *
 * Nothing else is touched. SmartSuite choice codes are unique only *within a
 * field*, so this map must never be pointed at another table's policy-type
 * field (`priorPolicies`, `quoteRecaps.productsQuoted`): the same code can mean
 * something unrelated there.
 *
 * ## ⚠ The labels are ours, not SmartSuite's
 *
 * Five of these are spelled differently in SmartSuite. The value written is the
 * canonical one from `POLICY_TYPES` (`packages/shared/src/domain/policy-type.ts`)
 * — the spelling the forms write, the filters expand to, and that rows which
 * were always labelled already hold. Writing SmartSuite's wording would leave
 * two spellings of one type side by side (`Boat` next to `Boat Owners`).
 *
 * Idempotent: every statement matches on a code, and once rewritten a row holds
 * no code, so a re-run after a partial failure matches nothing it already fixed.
 */

/**
 * The Policies table's Policy Type choices → canonical label.
 *
 * Frozen here on purpose rather than read from `@sfa/shared`: a migration has
 * to keep meaning what it meant on the day it ran, whatever the vocabulary
 * becomes afterwards.
 */
const POLICY_TYPE_LABELS = {
  Zgsh3: 'Auto',
  eCEuV: 'Home',
  F3oxm: 'Renters',
  AiFB5: 'Landlord',
  le1BC: 'Umbrella',
  gGKei: 'Motorcycle',
  ayKjZ: 'Valuable Item Protection', // SmartSuite: "Item Protection"
  UrNOp: 'Condominium', // SmartSuite: "Condo"
  Tz3ny: 'Manufactured Home', // SmartSuite: "Manufactured Homes"
  BK08B: 'Boat Owners', // SmartSuite: "Boat"
  HicyK: 'Life',
  sTSOE: 'RV',
  cgoHC: 'ATV / ORV', // SmartSuite: "ATVs / ORVs"
};

const CODES = Object.keys(POLICY_TYPE_LABELS);

const TAG = '[policy-type-codes-to-labels]';

/**
 * An aggregation expression: `input` translated to its label, or `input`
 * itself when it is not one of the codes.
 *
 * @param {string} input an aggregation field path or variable
 */
function labelFor(input) {
  return {
    $switch: {
      branches: Object.entries(POLICY_TYPE_LABELS).map(([code, label]) => ({
        case: { $eq: [input, code] },
        then: label,
      })),
      default: input,
    },
  };
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    for (const name of ['policies', 'serviceTickets']) {
      const result = await db
        .collection(name)
        .updateMany({ policyType: { $in: CODES } }, [
          { $set: { policyType: labelFor('$policyType') } },
        ]);
      console.log(
        `${TAG} ${name}.policyType — relabelled ${result.modifiedCount} of ${result.matchedCount} holding a code.`,
      );
    }

    /*
     * The array is a set of the deal's policy types, so two entries that become
     * the same label (a code beside the label it stands for) collapse into one.
     * `$reduce` rather than `$setUnion` because the latter does not keep order.
     */
    const deals = await db
      .collection('deals')
      .updateMany({ policyTypes: { $in: CODES } }, [
        {
          $set: {
            policyTypes: {
              $reduce: {
                input: '$policyTypes',
                initialValue: [],
                in: {
                  $let: {
                    vars: { label: labelFor('$$this') },
                    in: {
                      $cond: [
                        { $in: ['$$label', '$$value'] },
                        '$$value',
                        { $concatArrays: ['$$value', ['$$label']] },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      ]);
    console.log(
      `${TAG} deals.policyTypes — relabelled ${deals.modifiedCount} of ${deals.matchedCount} holding a code.`,
    );
  },

  /**
   * @returns {Promise<void>}
   */
  async down() {
    /*
     * `up` collapses information: afterwards a policy that held `BK08B` is
     * indistinguishable from one that always read "Boat Owners", so there is no
     * set of rows to turn back into codes — and the code was the defect, not a
     * state worth restoring. Rolling the application back without this is safe:
     * every reader has always accepted the label.
     */
    throw new Error(
      'policy_type_codes_to_labels: irreversible — a relabelled row cannot be told apart from one that always held the label.',
    );
  },
};
