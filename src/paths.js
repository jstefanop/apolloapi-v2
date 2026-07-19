const fs = require('fs');
const os = require('os');
const path = require('path');

// Single source of truth for where mutable runtime state lives, so the code
// checkout can stay clean/read-only for prebuilt (OTA) updates.
//
// - APOLLO_STATE_DIR wins (tests, overrides).
// - production defaults to /var/lib/apollo (systemd StateDirectory=apollo).
// - development/test fall back to a throwaway tmp dir.
function getStateDir() {
  if (process.env.APOLLO_STATE_DIR) return process.env.APOLLO_STATE_DIR;
  if (process.env.NODE_ENV === 'production') return '/var/lib/apollo';
  return path.join(os.tmpdir(), 'apollo-runtime');
}

function getDbPath(stateDir = getStateDir()) {
  return path.join(stateDir, 'db', 'futurebit.sqlite');
}

function getMinerRuntimeDir(stateDir = getStateDir()) {
  return path.join(stateDir, 'miner');
}

// True when we manage runtime state under a state dir (production, or an
// explicit APOLLO_STATE_DIR). In plain development the DB stays in the repo.
function isManagedStateDir() {
  return process.env.NODE_ENV === 'production' || !!process.env.APOLLO_STATE_DIR;
}

// The legacy in-checkout DB location used before state was relocated.
function getLegacyDbPath() {
  return path.join(__dirname, '..', 'futurebit.sqlite');
}

function defaultEnvPath() {
  return path.join(__dirname, '..', '.env');
}

// The DATABASE_URL a fresh install should be created with.
function defaultDatabaseUrl() {
  return isManagedStateDir() ? getDbPath() : getLegacyDbPath();
}

function moveFile(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    // /opt and /var/lib may live on different mounts → rename gives EXDEV.
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

function rewriteEnvDatabaseUrl(envPath, dbUrl) {
  let contents = '';
  try {
    contents = fs.readFileSync(envPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const line = `DATABASE_URL=${dbUrl}`;
  if (/^DATABASE_URL=.*$/m.test(contents)) {
    contents = contents.replace(/^DATABASE_URL=.*$/m, line);
  } else {
    contents = contents.replace(/\n*$/, '\n') + line + '\n';
  }
  fs.writeFileSync(envPath, contents, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}

// Relocate the sqlite DB into the managed state dir on first boot, and keep
// .env + process.env in sync. Idempotent. MUST run before ./db is required,
// because knex resolves DATABASE_URL at require time.
function ensureDbLocation({ envPath = defaultEnvPath() } = {}) {
  if (!isManagedStateDir()) return; // dev/test: leave the repo DB in place

  const desired = getDbPath();
  fs.mkdirSync(path.dirname(desired), { recursive: true, mode: 0o700 });

  const current = process.env.DATABASE_URL;
  if (current && path.resolve(current) === path.resolve(desired)) return;

  // Move a legacy DB (and its -wal/-shm siblings) if present and not yet moved.
  if (current && fs.existsSync(current) && !fs.existsSync(desired)) {
    for (const suffix of ['', '-wal', '-shm']) {
      const from = current + suffix;
      if (fs.existsSync(from)) moveFile(from, desired + suffix);
    }
  }

  process.env.DATABASE_URL = desired;
  rewriteEnvDatabaseUrl(envPath, desired);
}

module.exports = {
  getStateDir,
  getDbPath,
  getMinerRuntimeDir,
  getLegacyDbPath,
  isManagedStateDir,
  defaultEnvPath,
  defaultDatabaseUrl,
  ensureDbLocation,
};
