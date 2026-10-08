import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { cron } from 'inngest';
import type { Model } from 'mongoose';
import {
  DataExport,
  type DataExportDocument,
} from '../../data-export/schemas/data-export.schema';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import { StorageService } from '../../storage/storage.service';

/** Rows handled per pass; the loop continues until none are due. */
const PAGE_SIZE = 100;

/**
 * Delete Data Export files past their retention (PAC-152).
 *
 * A stored export is a bulk copy of the agency's contact details, so it is
 * kept for `DATA_EXPORT_RETENTION_DAYS` and no longer. The row stays, marked
 * `expired` with its file pointer cleared: it is the audit trail of who
 * exported what, and that outlives the file.
 *
 * Hourly, which makes "expires at" accurate to the hour — the page and the
 * download endpoint both treat a `ready` row past `expiresAt` as expired, so a
 * file awaiting this sweep is never offered.
 *
 * Delete first, then mark. A crash between the two leaves a `ready` row whose
 * object is gone, which the next pass deletes again (S3 delete is idempotent)
 * and marks; the reverse order would leave an orphaned file nothing points at.
 */
@Injectable()
@InngestFunction()
export class DataExportExpireFn implements InngestFunctionProvider {
  private readonly logger = new Logger(DataExportExpireFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly storage: StorageService,
    @InjectModel(DataExport.name)
    private readonly exportModel: Model<DataExportDocument>,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'data-export-expire',
        name: 'Delete expired data export files',
        triggers: [cron('0 * * * *')],
        /** Two sweeps at once would only race to delete the same objects. */
        concurrency: { limit: 1 },
      },
      () => this.sweep(),
    );
  }

  /** The body, callable directly from a test. */
  async sweep(now = new Date()): Promise<{ expired: number }> {
    let expired = 0;
    for (;;) {
      const due = await this.exportModel
        .find({ status: 'ready', expiresAt: { $lte: now } })
        .select({ _id: 1, file: 1 })
        .limit(PAGE_SIZE)
        .lean();
      if (due.length === 0) break;

      let expiredThisPage = 0;
      for (const row of due) {
        if (row.file?.storageKey) {
          try {
            await this.storage.deleteObject(row.file.storageKey);
          } catch (error) {
            // Leave the row `ready` so the next pass retries; it is already
            // past `expiresAt`, so nobody is offered it in the meantime.
            this.logger.warn(
              `Could not delete export file ${row.file.storageKey}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            continue;
          }
        }
        await this.exportModel.updateOne(
          { _id: row._id, status: 'ready' },
          { $set: { status: 'expired', file: null } },
        );
        expiredThisPage += 1;
      }
      expired += expiredThisPage;
      // A row whose delete failed stays due and would be fetched again; stop
      // when a page made no progress rather than spin on it until the next run.
      if (due.length < PAGE_SIZE || expiredThisPage < due.length) break;
    }
    if (expired) this.logger.log(`Expired ${expired} data export file(s).`);
    return { expired };
  }
}
