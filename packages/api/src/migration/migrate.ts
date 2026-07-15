import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MigrationModule } from './migration.module';
import { MigrationService, MigrationOptions } from './migration.service';
import { printReport, writeReport } from './report';

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
    const report = await service.run(options);
    printReport(report);
    const path = writeReport(report);
    logger.log(`Report written to ${path}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
