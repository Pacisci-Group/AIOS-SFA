import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

/**
 * Records documents a unit of work *created*, so the no-transaction fallback can
 * undo them. Reused documents are never tracked — the whole point of the intake
 * pipeline is that it matches existing contacts and households, and deleting one
 * of those would destroy real client data.
 */
export interface CreatedRegistry {
  track(model: Model<unknown>, id: Types.ObjectId): void;
}

interface TrackedDocument {
  model: Model<unknown>;
  id: Types.ObjectId;
}

/** Subset of the `hello` command reply we care about. */
interface HelloReply {
  setName?: string;
  msg?: string;
}

/**
 * Runs a unit of work atomically.
 *
 * MongoDB only supports multi-document transactions on a replica set or a
 * sharded cluster. Local dev and CI run a single-node replica set (`rs0`, see
 * `docker-compose.yml`) and production is DigitalOcean Managed MongoDB, so the
 * real path is `withTransaction` everywhere.
 *
 * The fallback exists for one case: a developer whose mongo container predates
 * the replica-set change. Rather than every intake request failing with an
 * opaque `IllegalOperation` at runtime, the work still completes and any
 * documents it created are deleted on failure. That is strictly weaker than a
 * transaction — the compensating delete can itself fail — so it logs loudly and
 * must never be how production runs.
 */
@Injectable()
export class TransactionRunner implements OnModuleInit {
  private readonly logger = new Logger(TransactionRunner.name);
  private supported = false;

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit(): Promise<void> {
    this.supported = await this.probeTransactionSupport();
    if (this.supported) {
      this.logger.log('MongoDB transactions available (replica set / mongos).');
      return;
    }
    this.logger.warn(
      'MongoDB is NOT a replica set — multi-document writes will run WITHOUT ' +
        'transactions, using compensating deletes only. Recreate the mongo ' +
        'container (`docker compose up -d mongo mongo-init`) to restore ' +
        'atomicity. Never run production this way.',
    );
  }

  /** Exposed so a health/diagnostic surface can report degraded atomicity. */
  get transactionsSupported(): boolean {
    return this.supported;
  }

  async run<T>(
    fn: (session: ClientSession | null, created: CreatedRegistry) => Promise<T>,
  ): Promise<T> {
    return this.supported ? this.runInTransaction(fn) : this.runCompensated(fn);
  }

  private async runInTransaction<T>(
    fn: (session: ClientSession | null, created: CreatedRegistry) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result!: T;
      // `withTransaction` may re-run the callback on a transient error, so the
      // callback must stay idempotent. Nothing is tracked here: an aborted
      // transaction leaves no documents to compensate.
      await session.withTransaction(async () => {
        result = await fn(session, NOOP_REGISTRY);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  private async runCompensated<T>(
    fn: (session: ClientSession | null, created: CreatedRegistry) => Promise<T>,
  ): Promise<T> {
    const tracked: TrackedDocument[] = [];
    const registry: CreatedRegistry = {
      track: (model, id) => tracked.push({ model, id }),
    };

    try {
      return await fn(null, registry);
    } catch (error) {
      await this.compensate(tracked);
      throw error;
    }
  }

  /** Reverse order, so children are removed before the documents they point at. */
  private async compensate(tracked: TrackedDocument[]): Promise<void> {
    for (const { model, id } of [...tracked].reverse()) {
      try {
        await model.deleteOne({ _id: id });
      } catch (error) {
        this.logger.error(
          `Compensating delete failed for ${model.modelName} ${id.toString()} — ` +
            'a partial record has been left behind.',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  private async probeTransactionSupport(): Promise<boolean> {
    try {
      const connection = await this.connection.asPromise();
      const db = connection.db;
      if (!db) return false;
      const hello = (await db.admin().command({ hello: 1 })) as HelloReply;
      // `setName` = replica set member; `msg: 'isdbgrid'` = mongos.
      return Boolean(hello.setName) || hello.msg === 'isdbgrid';
    } catch (error) {
      this.logger.error(
        'Could not determine MongoDB transaction support; assuming unsupported.',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}

const NOOP_REGISTRY: CreatedRegistry = { track: () => undefined };
