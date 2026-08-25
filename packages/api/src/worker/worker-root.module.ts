import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ENV_FILE_PATH } from '../config/env.config';
import { InngestModule } from '../inngest/inngest.module';
import { WorkerModule } from './worker.module';

/**
 * Root module for the **standalone** worker process (`dist/worker.js`).
 *
 * Self-contained by design, following the same pattern as
 * `migration/migration.module.ts`: it re-declares config and the database
 * connection so it can boot without `AppModule` — and therefore without the
 * seven global HTTP guards, the throttler, or any feature controller, none of
 * which a worker has any use for.
 *
 * Today `WORKER_INLINE` defaults to true and `AppModule` imports
 * {@link WorkerModule} directly, so this root is exercised only by
 * `npm run worker:dev` and the dormant `worker` compose profile. Keeping it
 * working is the point: it is what makes splitting the worker onto its own
 * container a config change rather than a refactor, and the only way to know it
 * still works is to keep running it.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATH }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI', 'mongodb://localhost:27017/sfa'),
        // The API owns every index on every collection it declares. A worker
        // building them would race the API's autoIndex at boot on a shared
        // cluster, and would build them from whatever subset of the schema this
        // process happens to register. Worker-owned collections opt back in
        // explicitly through WorkerIndexesService.
        autoIndex: false,
        autoCreate: false,
      }),
    }),
    InngestModule,
    WorkerModule,
  ],
})
export class WorkerRootModule {}
