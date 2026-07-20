const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { getStateDir } = require('../paths');

const CREDENTIALS_VERSION = 1;
const LAN_USERNAME = 'futurebit';
const CKPOOL_USERNAME = 'apollo-ckpool';

function getCredentialsPath(stateDir = getStateDir()) {
  return path.join(stateDir, 'rpc-credentials.json');
}

function passwordToHmac(salt, password) {
  return crypto
    .createHmac('sha256', Buffer.from(salt, 'utf8'))
    .update(Buffer.from(password, 'utf8'))
    .digest('hex');
}

function generatePassword() {
  return crypto.randomBytes(32).toString('base64url');
}

function createIdentity(username, password = generatePassword()) {
  if (!username || username.includes(':')) {
    throw new Error('RPC username must be non-empty and cannot contain ":"');
  }
  if (!password || password.includes(':') || /[\r\n]/.test(password)) {
    throw new Error('RPC password must be non-empty and cannot contain colons or newlines');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  return {
    username,
    password,
    salt,
    hmac: passwordToHmac(salt, password),
  };
}

function identityToRpcauth(identity) {
  return `${identity.username}:${identity.salt}$${identity.hmac}`;
}

function validateIdentity(identity, expectedUsername) {
  if (!identity || identity.username !== expectedUsername) return false;
  if (
    typeof identity.password !== 'string' ||
    typeof identity.salt !== 'string' ||
    typeof identity.hmac !== 'string' ||
    !/^[0-9a-f]{32}$/i.test(identity.salt) ||
    !/^[0-9a-f]{64}$/i.test(identity.hmac)
  ) {
    return false;
  }
  if (
    identity.password.length === 0 ||
    identity.password.includes(':') ||
    /[\r\n]/.test(identity.password)
  ) {
    return false;
  }
  const storedHmac = Buffer.from(identity.hmac, 'utf8');
  const expectedHmac = Buffer.from(
    passwordToHmac(identity.salt, identity.password),
    'utf8'
  );
  return (
    storedHmac.length === expectedHmac.length &&
    crypto.timingSafeEqual(storedHmac, expectedHmac)
  );
}

function validateCredentials(credentials) {
  return Boolean(
    credentials &&
      credentials.version === CREDENTIALS_VERSION &&
      validateIdentity(credentials.lan, LAN_USERNAME) &&
      validateIdentity(credentials.ckpool, CKPOOL_USERNAME)
  );
}

async function atomicWrite(filePath, contents, mode = 0o600) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto
    .randomBytes(6)
    .toString('hex')}`;
  let handle;

  try {
    handle = await fs.open(temporaryPath, 'wx', mode);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, mode);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function readLegacyPassword(knex) {
  if (!knex) return { id: null, password: null };

  const row = await knex('settings')
    .select(['id', 'node_rpc_password'])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .first();

  const password =
    typeof row?.node_rpc_password === 'string' &&
    row.node_rpc_password.length > 0 &&
    !row.node_rpc_password.includes(':') &&
    !/[\r\n]/.test(row.node_rpc_password)
      ? row.node_rpc_password
      : null;

  return { id: row?.id || null, password };
}

async function synchronizeLegacyPassword(knex, id, password) {
  if (!knex || !id) return;
  await knex('settings')
    .where({ id })
    .update({ node_rpc_password: password });
}

async function loadRpcCredentials({ stateDir = getStateDir() } = {}) {
  const credentialsPath = getCredentialsPath(stateDir);
  const contents = await fs.readFile(credentialsPath, 'utf8');
  const credentials = JSON.parse(contents);

  if (!validateCredentials(credentials)) {
    throw new Error(`Invalid RPC credential store: ${credentialsPath}`);
  }

  return credentials;
}

async function ensureRpcCredentials(knex, { stateDir = getStateDir() } = {}) {
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await fs.chmod(stateDir, 0o700);

  try {
    const credentials = await loadRpcCredentials({ stateDir });
    await fs.chmod(getCredentialsPath(stateDir), 0o600);
    const legacy = await readLegacyPassword(knex);
    await synchronizeLegacyPassword(
      knex,
      legacy.id,
      credentials.lan.password
    );
    return credentials;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const legacy = await readLegacyPassword(knex);
  const credentials = {
    version: CREDENTIALS_VERSION,
    lan: createIdentity(LAN_USERNAME, legacy.password || generatePassword()),
    ckpool: createIdentity(CKPOOL_USERNAME),
  };

  // Keep the legacy column synchronized for one migration window so a rollback
  // does not unexpectedly change a user's existing LAN credential.
  await synchronizeLegacyPassword(knex, legacy.id, credentials.lan.password);

  await atomicWrite(
    getCredentialsPath(stateDir),
    `${JSON.stringify(credentials, null, 2)}\n`,
    0o600
  );

  return credentials;
}

module.exports = {
  CKPOOL_USERNAME,
  LAN_USERNAME,
  createIdentity,
  ensureRpcCredentials,
  getCredentialsPath,
  getStateDir,
  identityToRpcauth,
  loadRpcCredentials,
  passwordToHmac,
  validateCredentials,
};
