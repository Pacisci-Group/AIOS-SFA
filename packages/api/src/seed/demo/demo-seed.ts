import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DemoSeedModule } from './demo-seed.module';
import { DemoSeedService, DemoSeedOptions } from './demo-seed.service';
import { DEMO_CONFIG } from './demo-data';

function parseOptions(argv: string[]): DemoSeedOptions {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    agencySlug: value('--agency', 'smith-family-agency'),
    agencyName: value('--agency-name', 'Smith Family Agency'),
    fresh: has('--fresh'),
    seed:
      parseInt(value('--seed', String(DEMO_CONFIG.seed)), 10) ||
      DEMO_CONFIG.seed,
    password: process.env.SEED_DEFAULT_PASSWORD ?? 'ChangeMe123!',
  };
}

async function main() {
  const logger = new Logger('DemoSeed');
  const options = parseOptions(process.argv.slice(2));
  logger.log(
    `Seeding demo tenant (agency=${options.agencySlug}, fresh=${options.fresh}, seed=${options.seed})`,
  );

  const app = await NestFactory.createApplicationContext(DemoSeedModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = app.get(DemoSeedService);
    const summary = await service.run(options);

    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    logger.log('Demo seed complete.');
    console.log('\nAgency:', summary.agencySlug, `(${summary.agencyId})`);
    console.table(summary.counts);
    console.log(`Total documents upserted: ${total}\n`);
    console.log('Logins (all use the same demo password):');
    for (const login of summary.logins) {
      console.log(
        `  ${login.role.padEnd(14)} ${login.email} / ${login.password}`,
      );
    }
    console.log('');

    // A mailer is only reachable *by* its control number — there is no list
    // view — so printing a few is the difference between the demo mailers
    // being testable and being invisible.
    if (summary.sampleMailerControlNumbers.length > 0) {
      console.log('Sample Quote Control Numbers (either form resolves):');
      for (const qcn of summary.sampleMailerControlNumbers) {
        console.log(`  ${qcn.short}   ${qcn.long}`);
      }
      console.log('');
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Demo seed failed:', err);
  process.exit(1);
});
