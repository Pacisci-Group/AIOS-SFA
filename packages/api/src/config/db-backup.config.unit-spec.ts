import {
  DB_BACKUP_SCHEDULE,
  DEFAULT_DB_BACKUP_DUMP_PARALLEL,
  DEFAULT_DB_BACKUP_KEEP,
  dbBackupAlertEmail,
  dbBackupDumpParallel,
  dbBackupDumpTimeoutMs,
  dbBackupEnabled,
  dbBackupKeep,
} from './db-backup.config';

describe('dbBackupEnabled', () => {
  /** Off unless someone said so — an environment without a bucket must not try. */
  it('is off unless the value is literally true', () => {
    expect(dbBackupEnabled(undefined)).toBe(false);
    expect(dbBackupEnabled('')).toBe(false);
    expect(dbBackupEnabled('false')).toBe(false);
    expect(dbBackupEnabled('1')).toBe(false);
    expect(dbBackupEnabled('yes')).toBe(false);
  });

  it('tolerates case and whitespace', () => {
    expect(dbBackupEnabled('true')).toBe(true);
    expect(dbBackupEnabled(' TRUE ')).toBe(true);
  });
});

describe('dbBackupKeep', () => {
  it('defaults to one current archive and three older ones', () => {
    expect(DEFAULT_DB_BACKUP_KEEP).toBe(4);
    expect(dbBackupKeep(undefined)).toBe(4);
    expect(dbBackupKeep('')).toBe(4);
    expect(dbBackupKeep('four')).toBe(4);
  });

  /** Never zero: rotation must always keep the archive it just wrote. */
  it('clamps to at least one and at most a year of Sundays', () => {
    expect(dbBackupKeep('0')).toBe(1);
    expect(dbBackupKeep('-3')).toBe(1);
    expect(dbBackupKeep('999')).toBe(52);
    expect(dbBackupKeep('8')).toBe(8);
  });
});

describe('dbBackupDumpTimeoutMs', () => {
  it('defaults to 45 minutes', () => {
    expect(dbBackupDumpTimeoutMs(undefined)).toBe(45 * 60_000);
  });

  /** The ceiling keeps dump + upload inside Inngest's two-hour step limit. */
  it('clamps to 5–110 minutes', () => {
    expect(dbBackupDumpTimeoutMs('1')).toBe(5 * 60_000);
    expect(dbBackupDumpTimeoutMs('600')).toBe(110 * 60_000);
    expect(dbBackupDumpTimeoutMs('30')).toBe(30 * 60_000);
  });
});

describe('dbBackupDumpParallel', () => {
  it('defaults to 2 and clamps to 1–8', () => {
    expect(dbBackupDumpParallel(undefined)).toBe(
      DEFAULT_DB_BACKUP_DUMP_PARALLEL,
    );
    expect(dbBackupDumpParallel('0')).toBe(1);
    expect(dbBackupDumpParallel('64')).toBe(8);
  });
});

describe('dbBackupAlertEmail', () => {
  it('trims, and treats blank as unset', () => {
    expect(dbBackupAlertEmail('  ops@example.com ')).toBe('ops@example.com');
    expect(dbBackupAlertEmail('   ')).toBeNull();
    expect(dbBackupAlertEmail(undefined)).toBeNull();
  });
});

describe('DB_BACKUP_SCHEDULE', () => {
  /**
   * Pinned, because the schedule was a decision: Sunday 13:00 PKT is 08:00 UTC
   * and the middle of the night for the agency. Dropping the prefix would
   * quietly run it at 13:00 UTC instead — mid-morning in Chicago, while the
   * agency is working.
   */
  it('runs Sundays at 13:00 Pakistan time', () => {
    expect(DB_BACKUP_SCHEDULE).toBe('TZ=Asia/Karachi 0 13 * * 0');
  });
});
