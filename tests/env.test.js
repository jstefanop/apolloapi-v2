// tests/setup.js mocks child_process; this one needs the real thing.
const { spawnSync } = jest.requireActual('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// The bug lives in module-load order, so it is proved in a fresh process on a
// directory that has no .env: the way a new checkout starts. The .env goes in a
// subdirectory of the working directory: config/default.js also tries ./.env, and
// finding the file that way would hide whether ensureEnvFile loaded it.
const run = (script) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-env-'));
  fs.mkdirSync(path.join(dir, 'app'));
  const file = path.join(dir, 'probe.js');
  fs.writeFileSync(file, script(dir));
  const env = { ...process.env, NODE_ENV: 'development', NODE_CONFIG_DIR: path.join(ROOT, 'config') };
  delete env.APP_SECRET;
  delete env.DATABASE_URL;
  const out = spawnSync(process.execPath, [file], { cwd: dir, env, encoding: 'utf8' });
  return { dir, out };
};

const probe = (dir) => `
  const { ensureEnvFile } = require(${JSON.stringify(path.join(ROOT, 'src', 'env.js'))});
  ensureEnvFile(${JSON.stringify(path.join(dir, 'app', '.env'))});
  const config = require(${JSON.stringify(path.join(ROOT, 'node_modules', 'config'))});
  process.stdout.write(config.get('server.secret'));
`;

describe('first start without a .env', () => {
  it('creates it and the secret is in config in the same process', () => {
    const { dir, out } = run(probe);
    expect(out.stderr).toBe('');
    expect(out.stdout).toMatch(/^[0-9a-f]{128}$/);
    const written = fs.readFileSync(path.join(dir, 'app', '.env'), 'utf8');
    expect(written).toContain(`APP_SECRET=${out.stdout}`);
    expect(written).toMatch(/^DATABASE_URL=.*futurebit\.sqlite$/m);
    expect(fs.statSync(path.join(dir, 'app', '.env')).mode & 0o777).toBe(0o600);
  });

  it('keeps the secret an existing .env already has', () => {
    const { out } = run((dir) => {
      fs.writeFileSync(path.join(dir, 'app', '.env'), 'APP_SECRET=keepme\n');
      return probe(dir);
    });
    expect(out.stdout).toBe('keepme');
  });

  it('is what the old order got wrong: config first, .env second', () => {
    const { out } = run(
      (dir) => `
        const config = require(${JSON.stringify(path.join(ROOT, 'node_modules', 'config'))});
        require('fs').writeFileSync(${JSON.stringify(path.join(dir, 'app', '.env'))}, 'APP_SECRET=late\\n');
        require(${JSON.stringify(path.join(ROOT, 'node_modules', 'dotenv'))}).config({ path: ${JSON.stringify(path.join(dir, 'app', '.env'))} });
        try { config.get('server.secret'); process.stdout.write('found'); }
        catch (e) { process.stdout.write('undefined'); }
      `
    );
    expect(out.stdout).toBe('undefined');
  });
});

describe('an .env that already exists', () => {
  const envFile = (dir) => path.join(dir, 'app', '.env');

  // `before` runs inside the child, ahead of ensureEnvFile, for the cases that
  // need a failing fs call.
  const probeWith = (dir, before = '') => `
    const fs = require('fs');
    ${before}
    const { ensureEnvFile } = require(${JSON.stringify(path.join(ROOT, 'src', 'env.js'))});
    ensureEnvFile(${JSON.stringify(envFile(dir))});
    const config = require(${JSON.stringify(path.join(ROOT, 'node_modules', 'config'))});
    process.stdout.write(config.get('server.secret'));
  `;

  it.each([
    ['empty', ''],
    ['without APP_SECRET, no trailing newline', 'DATABASE_URL=/x/y.sqlite'],
    ['with an empty APP_SECRET=', 'DATABASE_URL=/x/y.sqlite\nAPP_SECRET=\n'],
  ])('gets a generated secret when it is %s', (_label, initial) => {
    let dir;
    const { out } = run((d) => {
      dir = d;
      fs.writeFileSync(envFile(d), initial);
      return probeWith(d);
    });
    expect(out.stderr).toBe('');
    expect(out.stdout).toMatch(/^[0-9a-f]{128}$/);
    const written = fs.readFileSync(envFile(dir), 'utf8');
    // Persisted, once, and the rest of the file is left alone.
    expect(written.match(/^APP_SECRET=.+$/gm)).toEqual([`APP_SECRET=${out.stdout}`]);
    if (initial.includes('DATABASE_URL')) expect(written).toContain('DATABASE_URL=/x/y.sqlite\n');
  });

  it('boots when the mode cannot be changed (EPERM), with a warning', () => {
    const { out } = run((d) => {
      fs.writeFileSync(envFile(d), 'APP_SECRET=mine\n');
      return probeWith(
        d,
        `fs.chmodSync = () => { const e = new Error('nope'); e.code = 'EPERM'; throw e; };`
      );
    });
    expect(out.stdout).toBe('mine');
    expect(out.stderr).toMatch(/Could not restrict permissions/);
  });

  it('reads the file that another process created first (EEXIST)', () => {
    const { out } = run((d) =>
      probeWith(
        d,
        `
        const realWrite = fs.writeFileSync;
        fs.writeFileSync = (file, data, opts) => {
          if (opts && opts.flag === 'wx') {
            realWrite(file, 'APP_SECRET=theirs\\n');
            const e = new Error('exists'); e.code = 'EEXIST'; throw e;
          }
          return realWrite(file, data, opts);
        };
        `
      )
    );
    expect(out.stdout).toBe('theirs');
  });

  it('carries on with an in-memory secret when the file cannot be written', () => {
    const { out } = run((d) => {
      fs.writeFileSync(envFile(d), '');
      return probeWith(
        d,
        `
        fs.writeFileSync = (file, data, opts) => {
          const e = new Error('read-only');
          e.code = opts && opts.flag === 'wx' ? 'EEXIST' : 'EROFS';
          throw e;
        };
        `
      );
    });
    expect(out.stdout).toMatch(/^[0-9a-f]{128}$/);
    expect(out.stderr).toMatch(/Could not write APP_SECRET/);
  });

  // Root reads anything, so the case cannot be made there.
  (process.getuid && process.getuid() === 0 ? it.skip : it)(
    'stops with a clear error when the file cannot be read (EACCES), and leaves it alone',
    () => {
      let dir;
      const { out } = run((d) => {
        dir = d;
        fs.writeFileSync(envFile(d), 'APP_SECRET=theirs\n');
        fs.chmodSync(envFile(d), 0o000);
        // A file somebody else owns: the mode cannot be changed back, so it stays
        // unreadable (here the owner is us, hence the stub).
        return probeWith(
          d,
          `fs.chmodSync = () => { const e = new Error('nope'); e.code = 'EPERM'; throw e; };`
        );
      });
      try {
        expect(out.status).not.toBe(0);
        expect(out.stderr).toMatch(/Cannot read .*\.env \(EACCES\)/);
        expect(out.stdout).toBe(''); // no secret was invented and used
        fs.chmodSync(envFile(dir), 0o600);
        expect(fs.readFileSync(envFile(dir), 'utf8')).toBe('APP_SECRET=theirs\n');
      } finally {
        fs.chmodSync(envFile(dir), 0o600);
      }
    }
  );
});
