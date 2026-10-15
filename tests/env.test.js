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
