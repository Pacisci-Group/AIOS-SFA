import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

/**
 * One field on one row that the source could not honestly have held, and what
 * was written instead (PAC-80).
 *
 * Carries the legacy id so a human can open the offending record in SmartSuite
 * and fix it at source — which is the only real remedy. Re-running the import
 * will otherwise reject it again, correctly, forever.
 */
export interface FieldRejection {
  /** SmartSuite record id. */
  legacyId: string;
  field: string;
  /** What the source held. */
  value: number;
  /** The ceiling it failed. */
  limit: number;
  /** What was written in its place. */
  replacedWith: number;
}

/** How many rejections to print before truncating. */
export const REJECTION_SAMPLE_LIMIT = 20;

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
  /**
   * Rows written with a field replaced because the source value was impossible.
   *
   * ⚠ Deliberately **not** folded into `skipped`. The row *was* imported, and
   * the table's invariant is that every fetched row is counted once —
   * `migrated + skipped == fetched`. Conflating the two would both break that
   * and hide the fact that the record is present.
   */
  rejectedValues: number;
  /** A capped sample of the above, for the printed report. */
  rejections: FieldRejection[];
  /**
   * How this collection's producer links resolved (PAC-80). Absent on
   * collections that have no producer.
   *
   * `absent` — the source record names no producer — is counted separately from
   * `unresolved` — it names one we did not import. Only the second is a defect;
   * the first is a fact about the book. Conflating them is what let 441
   * unattributed deals sit behind a report line reading `Unmapped: 0`.
   */
  producerLinks?: { linked: number; unresolved: number; absent: number };
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
    /**
     * Producers whose SmartSuite "Monthly Goal" is 0 or empty, by name.
     *
     * The reason `producerGoals` can legitimately be 0: there is no goal data to
     * import. Named so an operator knows whose goal to go and set, rather than
     * reading a zero as a broken migration.
     */
    producersWithoutGoal: string[];
  };
  producers: {
    mapped: number;
    unmapped: string[];
  };
  errors: string[];
}

export function emptyStat(): CollectionStat {
  return {
    source: 0,
    fetched: 0,
    migrated: 0,
    excludedTest: 0,
    skipped: 0,
    rejectedValues: 0,
    rejections: [],
  };
}

/**
 * Record an implausible source value. Counts every occurrence but keeps only the
 * first {@link REJECTION_SAMPLE_LIMIT} for printing — a table with thousands of
 * bad rows must not produce thousands of lines of report.
 */
export function recordRejection(
  stat: CollectionStat,
  rejection: FieldRejection,
): void {
  stat.rejectedValues++;
  if (stat.rejections.length < REJECTION_SAMPLE_LIMIT) {
    stat.rejections.push(rejection);
  }
}

export function createReport(dryRun: boolean): MigrationReport {
  return {
    startedAt: new Date().toISOString(),
    dryRun,
    collections: {},
    derived: { producerGoals: 0, activities: 0, producersWithoutGoal: [] },
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
      'skipped'.padStart(9) +
      'rejected'.padStart(10),
  );
  for (const [name, s] of Object.entries(report.collections)) {
    console.log(
      name.padEnd(16) +
        String(s.source).padStart(9) +
        String(s.fetched).padStart(9) +
        String(s.migrated).padStart(10) +
        String(s.excludedTest).padStart(7) +
        String(s.skipped).padStart(9) +
        String(s.rejectedValues).padStart(10),
    );
  }
  console.log(line);

  /*
   * Named, not just counted. A bare "rejected: 3" tells an operator a problem
   * exists but not which SmartSuite record to open — and fixing it at source is
   * the only remedy, since a re-run will keep rejecting it.
   */
  const rejected = Object.entries(report.collections).filter(
    ([, s]) => s.rejectedValues > 0,
  );
  if (rejected.length) {
    console.log('Rejected field values (row imported, field replaced):');
    for (const [name, s] of rejected) {
      for (const r of s.rejections) {
        console.log(
          `  ${name.padEnd(16)} ${r.legacyId}  ${r.field}=${r.value} > ${r.limit}  -> ${r.replacedWith}`,
        );
      }
      if (s.rejectedValues > s.rejections.length) {
        console.log(
          `  ${name.padEnd(16)} … and ${s.rejectedValues - s.rejections.length} more`,
        );
      }
    }
    console.log(line);
  }
  const linked = Object.entries(report.collections).filter(
    ([, s]) => s.producerLinks,
  );
  if (linked.length) {
    console.log('Producer links:');
    for (const [name, s] of linked) {
      const l = s.producerLinks!;
      console.log(
        `  ${name.padEnd(16)} ${String(l.linked).padStart(6)} linked  ` +
          `${String(l.unresolved).padStart(6)} unresolved  ` +
          `${String(l.absent).padStart(6)} unattributed at source`,
      );
    }
    console.log(line);
  }

  console.log(
    `Derived  producerGoals: ${report.derived.producerGoals}  activities: ${report.derived.activities}`,
  );
  if (report.derived.producersWithoutGoal.length) {
    // Zero goals is a data-entry fact, not a broken import. Name whose.
    console.log(
      `  no Monthly Goal set in SmartSuite (${report.derived.producersWithoutGoal.length}): ` +
        report.derived.producersWithoutGoal.slice(0, 20).join(', ') +
        (report.derived.producersWithoutGoal.length > 20 ? ' …' : ''),
    );
  }
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
