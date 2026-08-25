import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { SequenceService } from './sequence.service';
import { TransactionRunner } from './transaction.runner';

/**
 * Global Mongo helpers. Provides {@link TransactionRunner} to any feature that
 * writes across more than one collection, so the transaction-capability probe
 * runs once per process rather than per module, and {@link SequenceService} for
 * the human-readable record numbers — global because the counters collection is
 * shared infrastructure and every feature that mints a reference needs it.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Counter.name, schema: CounterSchema }]),
  ],
  providers: [TransactionRunner, SequenceService],
  exports: [TransactionRunner, SequenceService],
})
export class MongoModule {}
