import { buildArgs, maskUri, mongoToolsConfigYaml } from './mongodump-runner';

const URI =
  'mongodb+srv://sfa_app:p%40ss"w\\rd@sfa-production-mongo.example.net/sfa?tls=true&authSource=admin';

describe('buildArgs', () => {
  /** argv is readable by every process on the host; the password must not be in it. */
  it('never carries the connection string', () => {
    const args = buildArgs({
      configPath: '/tmp/sfa-db-backup-x/mongodump.yaml',
      archivePath: '/tmp/sfa-db-backup-x/dump.archive.gz',
      numParallelCollections: 2,
    });
    expect(args.join(' ')).not.toContain('mongodb');
    expect(args).toEqual([
      '--config=/tmp/sfa-db-backup-x/mongodump.yaml',
      '--archive=/tmp/sfa-db-backup-x/dump.archive.gz',
      '--gzip',
      '--numParallelCollections=2',
    ]);
  });
});

describe('mongoToolsConfigYaml', () => {
  it('writes one double-quoted uri scalar, escaping quotes and backslashes', () => {
    expect(mongoToolsConfigYaml(URI)).toBe(
      'uri: "mongodb+srv://sfa_app:p%40ss\\"w\\\\rd@sfa-production-mongo.example.net/sfa?tls=true&authSource=admin"\n',
    );
  });
});

describe('maskUri', () => {
  it('hides the credentials and keeps the host and database', () => {
    expect(
      maskUri('mongodb+srv://sfa_app:secret@cluster.example.net/sfa?tls=true'),
    ).toBe('mongodb+srv://****@cluster.example.net/sfa?tls=true');
  });

  it('leaves a credential-less URI alone', () => {
    expect(maskUri('mongodb://localhost:27017/sfa')).toBe(
      'mongodb://localhost:27017/sfa',
    );
  });
});
