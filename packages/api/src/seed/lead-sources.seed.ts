import {
  PLATFORM_LEAD_SOURCES,
  leadSourceSlug,
  platformLeadSourceOrder,
} from '@sfa/shared';
import { Model } from 'mongoose';
import { LeadSource } from '../lead-sources/schemas/lead-source.schema';

/**
 * The platform lead sources (PAC-135).
 *
 * ## Why this is core seed data
 *
 * `GET /lead-sources` is the only source for the lead form's required source
 * select, and the mailer flow finds "Mailer" by slug. An empty collection means
 * no lead can be created by hand and none can be logged from a mail piece.
 *
 * ## `$setOnInsert` only — the zip-markets rule, not the carriers one
 *
 * A re-seed must never rewrite a row that already exists. Once the curation
 * surfaces land, a super admin renaming or archiving a platform source has made
 * a decision, and a redeploy quietly undoing it is the bug. The cost is that
 * editing {@link PLATFORM_LEAD_SOURCES} does not rename an existing row — that
 * takes a migration, which is the right amount of ceremony for changing what
 * every agency sees.
 *
 * Existing databases get the same rows from the `lead_sources_backfill`
 * migration, which has to create them before it can point records at them.
 */
export async function seedLeadSources(
  leadSourceModel: Model<LeadSource>,
): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const name of PLATFORM_LEAD_SOURCES) {
    const slug = leadSourceSlug(name);
    const result = await leadSourceModel.updateOne(
      { agencyId: null, slug },
      {
        $setOnInsert: {
          agencyId: null,
          slug,
          name,
          active: true,
          displayOrder: platformLeadSourceOrder(name),
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) created += 1;
    else existing += 1;
  }

  return { created, existing };
}
