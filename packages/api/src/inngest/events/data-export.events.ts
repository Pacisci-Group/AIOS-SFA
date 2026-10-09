import { eventType } from 'inngest';
import { z } from 'zod';
import { eventEnvelope, objectId } from './envelope';

/**
 * Event contracts for the Data Export page (PAC-152).
 *
 * Same rules as the rest of the catalog (see `email.events.ts`): no
 * transforms, ids only, `eventEnvelope` spread first.
 *
 * The payload is the export's id and nothing about *what* to export: the
 * `dataExports` row holds the validated filters and the requester's scope
 * snapshot, and the worker re-plans from that. A filter list on the event
 * would be a second copy that the row and the job could disagree about.
 *
 * `brand` is the one display field, resolved by the API when the export is
 * requested — exactly as the invite event carries it — because the agency's
 * branding is read by a feature service the worker may not import.
 */
const dataExportJobSchema = z.object({
  ...eventEnvelope,
  /** `DataExport._id`. The job reads its request from, and writes status to, it. */
  exportId: objectId,
  agencyId: objectId,
  /** The user who asked — who the file is for and who is emailed. */
  requestedBy: objectId,
  /** The agency's email masthead; the template falls back to the platform's. */
  brand: z
    .object({
      name: z.string(),
      logoUrl: z.string().url().nullable(),
    })
    .optional(),
});

/** Produce the file, store it, tell the requester it is ready. */
export const dataExportRequested = eventType(
  'data-export/export.requested.v1',
  { schema: dataExportJobSchema },
);

export type DataExportJobData = z.infer<typeof dataExportJobSchema>;
