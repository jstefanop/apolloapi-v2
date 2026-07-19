const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const {
  ensureRpcCredentials,
  getStateDir,
  identityToRpcauth,
  loadRpcCredentials,
} = require('./credentials');

const MANAGED_USER_OPTIONS = new Set([
  'bind',
  'chain',
  'conf',
  'daemon',
  'daemonwait',
  'datadir',
  'dns',
  'dnsseed',
  'includeconf',
  'listen',
  'maxconnections',
  'onlynet',
  'proxy',
  'regtest',
  'rpcallowip',
  'rpcauth',
  'rpcbind',
  'rpccookiefile',
  'rpccookieperms',
  'rpcpassword',
  'rpcport',
  'rpcuser',
  'rpcwhitelist',
  'rpcwhitelistdefault',
  'server',
  'signet',
  'sysperms',
  'testnet',
  'testnet4',
  'zmqpubhashblock',
]);

function getRuntimePaths(stateDir = getStateDir()) {
  return {
    stateDir,
    credentials: path.join(stateDir, 'rpc-credentials.json'),
    bitcoinAuth: path.join(stateDir, 'bitcoin-auth.conf'),
    bitcoinApi: path.join(stateDir, 'bitcoin-api.conf'),
    bitcoinUser: path.join(stateDir, 'bitcoin-user.conf'),
    bitcoinRuntime: path.join(stateDir, 'bitcoin.conf'),
    ckpool: path.join(stateDir, 'ckpool.conf'),
  };
}

function setting(settings, camelName, snakeName, fallback = null) {
  if (settings?.[camelName] !== undefined) return settings[camelName];
  if (settings?.[snakeName] !== undefined) return settings[snakeName];
  return fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function ipv4ToInteger(address) {
  const octets = String(address)
    .split('.')
    .map((octet) => Number(octet));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets.reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
}

function integerToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function netmaskToPrefix(netmask) {
  const value = ipv4ToInteger(netmask);
  if (value === null) return null;
  const binary = value.toString(2).padStart(32, '0');
  if (!/^1*0*$/.test(binary)) return null;
  return binary.indexOf('0') === -1 ? 32 : binary.indexOf('0');
}

function interfaceToCidr(address, netmask) {
  const addressValue = ipv4ToInteger(address);
  const maskValue = ipv4ToInteger(netmask);
  const prefix = netmaskToPrefix(netmask);
  if (addressValue === null || maskValue === null || prefix === null) return null;
  return `${integerToIpv4((addressValue & maskValue) >>> 0)}/${prefix}`;
}

function isPrivateIpv4(address) {
  const octets = String(address).split('.').map(Number);
  return (
    octets.length === 4 &&
    (octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168))
  );
}

function getLanCidrs(interfaces) {
  if (interfaces === undefined) {
    try {
      interfaces = os.networkInterfaces();
    } catch (error) {
      console.warn(
        `[node-config] Could not enumerate network interfaces: ${error.message}`
      );
      interfaces = {};
    }
  }
  const cidrs = new Set();

  Object.entries(interfaces || {})
    .filter(([name]) => /^(eth|en|wlan|wl)/i.test(name))
    .flatMap(([, addresses]) => addresses || [])
    .filter(Boolean)
    .forEach((info) => {
      const isIpv4 = info.family === 'IPv4' || info.family === 4;
      if (!isIpv4 || info.internal || !info.address || !info.netmask) return;
      if (!isPrivateIpv4(info.address)) return;
      const cidr = interfaceToCidr(info.address, info.netmask);
      if (cidr) cidrs.add(cidr);
    });

  return [...cidrs].sort();
}

function renderAuthConfig(credentials) {
  return [
    '# Apollo managed Bitcoin RPC authentication',
    `rpcauth=${identityToRpcauth(credentials.lan)}`,
    `rpcauth=${identityToRpcauth(credentials.ckpool)}`,
    '',
  ].join('\n');
}

function renderApiConfig(settings, { lanCidrs = getLanCidrs() } = {}) {
  const lines = ['# Apollo managed Bitcoin configuration'];

  if (setting(settings, 'nodeEnableTor', 'node_enable_tor', false)) {
    lines.push(
      'proxy=127.0.0.1:9050',
      'listen=1',
      'bind=127.0.0.1',
      'onlynet=onion',
      'dnsseed=0',
      'dns=0'
    );
  }

  const maxConnections = positiveInteger(
    setting(settings, 'nodeMaxConnections', 'node_max_connections', 64),
    64
  );
  lines.push(`maxconnections=${maxConnections}`);

  if (setting(settings, 'nodeAllowLan', 'node_allow_lan', false)) {
    if (lanCidrs.length > 0) {
      lines.push('rpcbind=0.0.0.0');
      lines.push('rpcallowip=127.0.0.1');
      lanCidrs.forEach((cidr) => lines.push(`rpcallowip=${cidr}`));
    } else {
      lines.push('# LAN RPC requested, but no active LAN subnet was detected');
    }
  }

  if (
    setting(
      settings,
      'nodeEnableSoloMining',
      'node_enable_solo_mining',
      false
    )
  ) {
    lines.push('zmqpubhashblock=tcp://127.0.0.1:28332');
  }

  lines.push('');
  return lines.join('\n');
}

function renderUserConfig(settings) {
  const raw = setting(settings, 'nodeUserConf', 'node_user_conf', '');
  const output = ['# User custom Bitcoin configuration'];

  if (typeof raw === 'string' && raw.length > 0) {
    raw.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) {
        output.push(trimmed);
        return;
      }

      const option = trimmed
        .split('=', 1)[0]
        .trim()
        .toLowerCase()
        .replace(/^-+/, '');
      const positiveOption = option.startsWith('no') ? option.slice(2) : option;
      if (
        !MANAGED_USER_OPTIONS.has(option) &&
        !MANAGED_USER_OPTIONS.has(positiveOption)
      ) {
        output.push(trimmed);
      }
    });
  }

  output.push('');
  return output.join('\n');
}

function renderCkpoolConfig(settings, credentials) {
  const configuredBtcsig = setting(settings, 'btcsig', 'btcsig', null);
  const userBtcsig =
    typeof configuredBtcsig === 'string' &&
    configuredBtcsig.length > 0 &&
    configuredBtcsig.length <= 26 &&
    /^[\x20-\x7E]+$/.test(configuredBtcsig) &&
    !configuredBtcsig.includes('/')
      ? configuredBtcsig
      : 'mined by Solo Apollo';
  const startdiff = positiveInteger(
    setting(settings, 'startdiff', 'startdiff', 1024),
    1024
  );
  const mindiff = positiveInteger(
    setting(settings, 'mindiff', 'mindiff', 1),
    1
  );

  return `${JSON.stringify(
    {
      btcd: [
        {
          url: '127.0.0.1:8332',
          auth: credentials.ckpool.username,
          pass: credentials.ckpool.password,
          notify: true,
        },
      ],
      logdir: '/opt/apolloapi/backend/ckpool/logs',
      btcsig: `/FutureBit-${userBtcsig}/`,
      zmqblock: 'tcp://127.0.0.1:28332',
      startdiff,
      mindiff,
    },
    null,
    2
  )}\n`;
}

async function atomicWriteIfChanged(filePath, contents, mode = 0o600) {
  try {
    const existing = await fs.readFile(filePath, 'utf8');
    if (existing === contents) {
      await fs.chmod(filePath, mode);
      return false;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

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
    return true;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function readLatestNodeSettings(knex) {
  return knex('settings')
    .select([
      'node_enable_tor',
      'node_user_conf',
      'node_enable_solo_mining',
      'node_max_connections',
      'node_allow_lan',
      'btcsig',
      'startdiff',
      'mindiff',
      'node_software',
    ])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .first();
}

async function applyNodeConfigurationInternal({
  knex,
  settings,
  stateDir = getStateDir(),
  lanCidrs,
  credentials,
} = {}) {
  if (!settings) {
    if (!knex) throw new Error('Settings or a database connection is required');
    settings = await readLatestNodeSettings(knex);
  }
  if (!settings) throw new Error('No settings row exists for node configuration');

  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await fs.chmod(stateDir, 0o700);

  const rpcCredentials =
    credentials ||
    (knex
      ? await ensureRpcCredentials(knex, { stateDir })
      : await loadRpcCredentials({ stateDir }));
  const paths = getRuntimePaths(stateDir);
  const resolvedCidrs = lanCidrs === undefined ? getLanCidrs() : lanCidrs;

  const writes = [
    [paths.bitcoinAuth, renderAuthConfig(rpcCredentials)],
    [paths.bitcoinApi, renderApiConfig(settings, { lanCidrs: resolvedCidrs })],
    [paths.bitcoinUser, renderUserConfig(settings)],
    [paths.ckpool, renderCkpoolConfig(settings, rpcCredentials)],
  ];

  const changed = [];
  for (const [filePath, contents] of writes) {
    if (await atomicWriteIfChanged(filePath, contents, 0o600)) {
      changed.push(filePath);
    }
  }

  return { changed, credentials: rpcCredentials, paths };
}

let applyQueue = Promise.resolve();

function applyNodeConfiguration(options = {}) {
  const operation = applyQueue.then(() =>
    applyNodeConfigurationInternal(options)
  );
  applyQueue = operation.catch(() => {});
  return operation;
}

module.exports = {
  MANAGED_USER_OPTIONS,
  applyNodeConfiguration,
  getLanCidrs,
  getRuntimePaths,
  interfaceToCidr,
  isPrivateIpv4,
  readLatestNodeSettings,
  renderApiConfig,
  renderAuthConfig,
  renderCkpoolConfig,
  renderUserConfig,
};
