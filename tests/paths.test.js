// tests/paths.test.js
// ensureDbLocation() relocates the sqlite DB out of the code checkout into the
// managed state dir on first boot and keeps .env / process.env in sync. It runs
// before ./db is required, so it is plain sync fs work driven by env vars.

const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('../src/paths');

let tmpRoot;
let savedEnv;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-paths-'));
  savedEnv = {
    APOLLO_STATE_DIR: process.env.APOLLO_STATE_DIR,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  };
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  jest.restoreAllMocks();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function managed() {
  const stateDir = path.join(tmpRoot, 'state');
  process.env.APOLLO_STATE_DIR = stateDir;
  return {
    stateDir,
    desired: path.join(stateDir, 'db', 'futurebit.sqlite'),
    envPath: path.join(tmpRoot, '.env'),
  };
}

describe('ensureDbLocation', () => {
  it('is a no-op in development (DB stays in the checkout)', () => {
    delete process.env.APOLLO_STATE_DIR;
    process.env.NODE_ENV = 'development';
    const envPath = path.join(tmpRoot, '.env');
    fs.writeFileSync(envPath, 'DATABASE_URL=/repo/futurebit.sqlite\n');
    process.env.DATABASE_URL = '/repo/futurebit.sqlite';

    paths.ensureDbLocation({ envPath });

    expect(process.env.DATABASE_URL).toBe('/repo/futurebit.sqlite');
    expect(fs.readFileSync(envPath, 'utf8')).toContain(
      'DATABASE_URL=/repo/futurebit.sqlite'
    );
  });

  it('points a fresh install at the managed DB path and rewrites .env', () => {
    const { desired, envPath } = managed();
    fs.writeFileSync(envPath, 'APP_SECRET=deadbeef\n');
    delete process.env.DATABASE_URL; // fresh: nothing set yet

    paths.ensureDbLocation({ envPath });

    expect(process.env.DATABASE_URL).toBe(desired);
    expect(fs.existsSync(path.dirname(desired))).toBe(true);
    const env = fs.readFileSync(envPath, 'utf8');
    expect(env).toContain(`DATABASE_URL=${desired}`);
    expect(env).toContain('APP_SECRET=deadbeef'); // preserved
  });

  it('moves a legacy DB and its -wal/-shm siblings, then rewrites .env', () => {
    const { desired, envPath } = managed();
    const legacy = path.join(tmpRoot, 'futurebit.sqlite');
    fs.writeFileSync(legacy, 'MAINDB');
    fs.writeFileSync(`${legacy}-wal`, 'WAL');
    fs.writeFileSync(`${legacy}-shm`, 'SHM');
    fs.writeFileSync(envPath, `DATABASE_URL=${legacy}\nAPP_SECRET=x\n`);
    process.env.DATABASE_URL = legacy;

    paths.ensureDbLocation({ envPath });

    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(desired, 'utf8')).toBe('MAINDB');
    expect(fs.readFileSync(`${desired}-wal`, 'utf8')).toBe('WAL');
    expect(fs.readFileSync(`${desired}-shm`, 'utf8')).toBe('SHM');
    expect(process.env.DATABASE_URL).toBe(desired);
    expect(fs.readFileSync(envPath, 'utf8')).toContain(
      `DATABASE_URL=${desired}`
    );
  });

  it('falls back to copy+unlink when rename crosses filesystems (EXDEV)', () => {
    const { desired, envPath } = managed();
    const legacy = path.join(tmpRoot, 'futurebit.sqlite');
    fs.writeFileSync(legacy, 'CROSSFS');
    fs.writeFileSync(envPath, `DATABASE_URL=${legacy}\n`);
    process.env.DATABASE_URL = legacy;

    const realRename = fs.renameSync;
    jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      const err = new Error('cross-device link');
      err.code = 'EXDEV';
      throw err;
    });

    paths.ensureDbLocation({ envPath });
    fs.renameSync = realRename;

    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(desired, 'utf8')).toBe('CROSSFS');
  });

  it('is idempotent once the DB already lives in the managed path', () => {
    const { desired, envPath } = managed();
    fs.mkdirSync(path.dirname(desired), { recursive: true });
    fs.writeFileSync(desired, 'DB');
    fs.writeFileSync(envPath, `DATABASE_URL=${desired}\n`);
    process.env.DATABASE_URL = desired;

    const renameSpy = jest.spyOn(fs, 'renameSync');
    paths.ensureDbLocation({ envPath });

    expect(renameSpy).not.toHaveBeenCalled();
    expect(process.env.DATABASE_URL).toBe(desired);
    expect(fs.readFileSync(desired, 'utf8')).toBe('DB');
  });
});

describe('ensureMinerRuntimeDir', () => {
  function managedMiner() {
    const stateDir = path.join(tmpRoot, 'state');
    process.env.APOLLO_STATE_DIR = stateDir;
    const legacyDir = path.join(tmpRoot, 'checkout', 'backend', 'apollo-miner');
    fs.mkdirSync(legacyDir, { recursive: true });
    return { minerDir: path.join(stateDir, 'miner'), legacyDir };
  }

  it('is a no-op in development', () => {
    delete process.env.APOLLO_STATE_DIR;
    process.env.NODE_ENV = 'development';
    const legacyDir = path.join(tmpRoot, 'checkout');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'miner_config'), 'CFG');

    paths.ensureMinerRuntimeDir({ legacyDir });

    // Nothing created under a state dir, legacy file untouched.
    expect(fs.readFileSync(path.join(legacyDir, 'miner_config'), 'utf8')).toBe(
      'CFG'
    );
  });

  it('creates the runtime dir and moves regenerated config out of the checkout', () => {
    const { minerDir, legacyDir } = managedMiner();
    fs.writeFileSync(path.join(legacyDir, 'miner_config'), 'CFG');
    fs.writeFileSync(path.join(legacyDir, 'mode'), 'eco');
    fs.writeFileSync(path.join(legacyDir, 'miner_config3'), 'turbo');
    // A binary must stay in the checkout, not be moved.
    fs.writeFileSync(path.join(legacyDir, 'futurebit-miner'), 'ELF');

    paths.ensureMinerRuntimeDir({ legacyDir });

    expect(fs.readFileSync(path.join(minerDir, 'miner_config'), 'utf8')).toBe(
      'CFG'
    );
    expect(fs.readFileSync(path.join(minerDir, 'mode'), 'utf8')).toBe('eco');
    expect(fs.readFileSync(path.join(minerDir, 'miner_config3'), 'utf8')).toBe(
      'turbo'
    );
    expect(fs.existsSync(path.join(legacyDir, 'miner_config'))).toBe(false);
    expect(fs.existsSync(path.join(legacyDir, 'futurebit-miner'))).toBe(true);
  });

  it('creates the dir even with no legacy files, and does not clobber existing runtime config', () => {
    const { minerDir, legacyDir } = managedMiner();
    fs.mkdirSync(minerDir, { recursive: true });
    fs.writeFileSync(path.join(minerDir, 'miner_config'), 'CURRENT');
    fs.writeFileSync(path.join(legacyDir, 'miner_config'), 'STALE');

    paths.ensureMinerRuntimeDir({ legacyDir });

    // Existing runtime config wins; the stale checkout copy is left in place.
    expect(fs.readFileSync(path.join(minerDir, 'miner_config'), 'utf8')).toBe(
      'CURRENT'
    );
  });
});
