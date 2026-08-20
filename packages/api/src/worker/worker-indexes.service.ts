import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailMessage } from './email/schemas/email-message.schema';

/**
 * Builds indexes for the collections the worker **owns**.
 *
 * ## Why this is explicit rather than left to `autoIndex`
 * When the worker runs standalone it connects with `autoIndex: false`, because
 * it reads collections the API owns and a second process building their indexes
 * would race the API at boot — and would build them from partial definitions.
 * That flag is connection-global, so worker-owned collections need an opt-in,
 * and this is it.
 *
 * `syncIndexes()` rather than `createIndexes()` because these collections are
 * ours: `AGENTS.md` §11 documents the exact bug `autoIndex` alone causes — an
 * index whose *options* changed is never rebuilt, so editing the schema fixes
 * only collections created afterwards.
 *
 * ## ⚠ Never add an API-owned model to this list
 * `syncIndexes()` **drops** any index not present in the schema it is given.
 * Pointing it at a collection the API owns would silently delete production
 * indexes. Every model here must be one declared under `src/worker/`.
 */
@Injectable()
export class WorkerIndexesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkerIndexesService.name);

  constructor(
    @InjectModel(EmailMessage.name)
    private readonly emailMessages: Model<EmailMessage>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const owned: Model<any>[] = [this.emailMessages];

    for (const model of owned) {
      await model.syncIndexes();
      this.logger.log(`Synced indexes for ${model.collection.name}`);
    }
  }
}
