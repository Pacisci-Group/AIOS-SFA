import { Global, Module } from '@nestjs/common';
import { TransactionRunner } from './transaction.runner';

/**
 * Global Mongo helpers. Provides {@link TransactionRunner} to any feature that
 * writes across more than one collection, so the transaction-capability probe
 * runs once per process rather than per module.
 */
@Global()
@Module({
  providers: [TransactionRunner],
  exports: [TransactionRunner],
})
export class MongoModule {}
