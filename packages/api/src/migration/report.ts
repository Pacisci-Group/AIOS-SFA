import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

export interface CollectionStat {
  /** Count reported by the SmartSuite source table. */
  source: number;
  /** Rows fetched and processed. */
  fetched: number;
  /** Rows written/upserted (0 in dry-run). */
  migrated: number;
  /** Rows flagged test/sample/demo and excluded from write. */
  excludedTest: number;
  /** Rows skipped due to missing required data. */
  skipped: number;
}

export interface MigrationReport {
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  dryRun: boolean;
  agency?: { id: string; slug: string };
  branch?: { id: string; slug: string };
  collections: Record<string, CollectionStat>;
  derived: {
    producerGoals: number;
    activities: number;
  };
  producers: {
    mapped: number;
    unmapped: string[];
  };
  errors: string[];
}

export function emptyStat(): CollectionStat {
  return { source: 0, fetched: 0, migrated: 0, excludedTest: 0, skipped: 0 };
}

export function createReport(dryRun: boolean): MigrationReport {
  return {
    startedAt: new Date().toISOString(),
    dryRun,
    collections: {},
    derived: { producerGoals: 0, activities: 0 },
    producers: { mapped: 0, unmapped: [] },
    errors: [],
  };
}

export function writeReport(report: MigrationReport): string {
  const outPath = resolve(
    process.env.MIGRATION_REPORT_PATH ??
      resolve(process.cwd(), 'migration-report.json'),
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  return outPath;
}

export function printReport(report: MigrationReport): void {
  const line = '-'.repeat(72);
  console.log(`\n${line}`);
  console.log(
    `SmartSuite -> Mongo migration report${report.dryRun ? ' (DRY RUN)' : ''}`,
  );
  console.log(line);
  if (report.agency) {
    console.log(`Agency: ${report.agency.slug} (${report.agency.id})`);
  }
  if (report.branch) {
    console.log(`Branch: ${report.branch.slug} (${report.branch.id})`);
  }
  console.log(
    `Duration: ${report.durationMs ?? 0}ms  |  Producers mapped: ${report.producers.mapped}  |  Unmapped: ${report.producers.unmapped.length}`,
  );
  console.log(line);
  console.log(
    'collection'.padEnd(16) +
      'source'.padStart(9) +
      'fetched'.padStart(9) +
      'migrated'.padStart(10) +
      'test'.padStart(7) +
      'skipped'.padStart(9),
  );
  for (const [name, s] of Object.entries(report.collections)) {
    console.log(
      name.padEnd(16) +
        String(s.source).padStart(9) +
        String(s.fetched).padStart(9) +
        String(s.migrated).padStart(10) +
        String(s.excludedTest).padStart(7) +
        String(s.skipped).padStart(9),
    );
  }
  console.log(line);
  console.log(
    `Derived  producerGoals: ${report.derived.producerGoals}  activities: ${report.derived.activities}`,
  );
  if (report.producers.unmapped.length) {
    console.log(
      `Unmapped producer legacy ids: ${report.producers.unmapped.slice(0, 20).join(', ')}${report.producers.unmapped.length > 20 ? ' …' : ''}`,
    );
  }
  if (report.errors.length) {
    console.log(`Errors (${report.errors.length}):`);
    report.errors.slice(0, 20).forEach((e) => console.log(`  - ${e}`));
  }
  console.log(line);
}
