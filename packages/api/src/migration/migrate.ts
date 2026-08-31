import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MigrationModule } from './migration.module';
import { MigrationService, MigrationOptions } from './migration.service';
import {
  MigrationReport,
  MigrationRunError,
  printReport,
  writeReport,
} from './report';

function parseOptions(argv: string[]): MigrationOptions {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    dryRun: has('--dry-run'),
    agencySlug: value('--agency', 'smith-family-agency'),
    branchSlug: value('--branch', 'main'),
    pageSize: parseInt(value('--page-size', '500'), 10) || 500,
  };
}

async function main() {
  const logger = new Logger('Migrate');
  const options = parseOptions(process.argv.slice(2));
  logger.log(
    `Starting SmartSuite -> Mongo migration (dryRun=${options.dryRun}, agency=${options.agencySlug}, branch=${options.branchSlug})`,
  );

  const app = await NestFactory.createApplicationContext(MigrationModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(MigrationService);
    let report: MigrationReport;
    try {
      report = await service.run(options);
    } catch (err) {
      /*
       * A failed run still has a report worth reading — which stages landed,
       * how many rows each wrote, which rows were rejected. Print and write it
       * exactly as for a success, then rethrow so the exit code and the run
       * script's `FAILED` line are unchanged.
       */
      if (err instanceof MigrationRunError) {
        printReport(err.report);
        logger.warn(`Partial report written to ${writeReport(err.report)}`);
      }
      throw err;
    }
    printReport(report);
    const path = writeReport(report);
    logger.log(`Report written to ${path}`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  /*
   * Unwrap to the cause. A `MigrationRunError` carries the whole report, which
   * has already been printed in full above — logging the wrapper would repeat
   * it and bury the stack trace that says what actually broke.
   */
  const cause = err instanceof MigrationRunError ? err.cause : err;
  console.error('Migration failed:', cause);
  process.exit(1);
});
