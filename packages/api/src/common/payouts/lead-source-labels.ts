import type { Model, Types } from 'mongoose';
import type { LeadSource } from '../../lead-sources/schemas/lead-source.schema';

/**
 * Lead-source id → name for an agency: its own sources and the platform's,
 * archived ones included (an old sale still says where it came from).
 *
 * `LeadSourcesService.labelsFor` reads the same rows, but it is a feature
 * service and the statement job runs in the worker; this is the same query
 * against the model.
 */
export async function leadSourceLabels(
  leadSourceModel: Model<LeadSource>,
  agencyId: string,
): Promise<Map<string, string>> {
  const rows = await leadSourceModel
    .find({ agencyId: { $in: [null, agencyId] } })
    .select({ name: 1 })
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  return new Map(rows.map((row) => [String(row._id), row.name]));
}
