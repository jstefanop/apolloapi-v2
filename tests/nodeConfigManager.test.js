const {
  createIdentity,
  ensureRpcCredentials,
  identityToRpcauth,
  passwordToHmac,
  validateCredentials,
} = require('../src/node/credentials');
const {
  interfaceToCidr,
  isPrivateIpv4,
  getLanCidrs,
  renderApiConfig,
  renderAuthConfig,
  renderCkpoolConfig,
  renderUserConfig,
} = require('../src/node/configManager');
const {
  isLocalRpcHost,
  parseRpcCookie,
} = require('../src/services/node');
const createNodeService = require('../src/services/node');
const axios = require('axios');
const fs = require('fs');
const { knex } = require('../src/db');

describe('Bitcoin runtime configuration', () => {
  const credentials = {
    version: 1,
    lan: {
      username: 'futurebit',
      password: 'lan-secret',
      salt: '001122',
      hmac: passwordToHmac('001122', 'lan-secret'),
    },
    ckpool: {
      username: 'apollo-ckpool',
      password: 'pool-secret',
      salt: '334455',
      hmac: passwordToHmac('334455', 'pool-secret'),
    },
  };

  it('creates portable rpcauth values without plaintext passwords', () => {
    const rendered = renderAuthConfig(credentials);

    expect(passwordToHmac('001122', 'lan-secret')).toBe(
      'fe669d3873e57e33fa2a137cc85d0c4b2ed2367e3451ce0952c84ae2307ea6e4'
    );
    expect(rendered).toContain(`rpcauth=${identityToRpcauth(credentials.lan)}`);
    expect(rendered).toContain(
      `rpcauth=${identityToRpcauth(credentials.ckpool)}`
    );
    expect(rendered).not.toContain('lan-secret');
    expect(rendered).not.toContain('pool-secret');
  });

  it('validates generated credential identities', () => {
    const generated = {
      version: 1,
      lan: createIdentity('futurebit'),
      ckpool: createIdentity('apollo-ckpool'),
    };

    expect(validateCredentials(generated)).toBe(true);
    generated.lan.password = 'tampered';
    expect(validateCredentials(generated)).toBe(false);
  });

  it('limits LAN RPC access to detected subnets', () => {
    const rendered = renderApiConfig(
      { nodeAllowLan: true, nodeMaxConnections: 64 },
      { lanCidrs: ['192.168.50.0/24', '10.0.0.0/8'] }
    );

    expect(rendered).toContain('rpcbind=0.0.0.0');
    expect(rendered).toContain('rpcallowip=127.0.0.1');
    expect(rendered).toContain('rpcallowip=192.168.50.0/24');
    expect(rendered).toContain('rpcallowip=10.0.0.0/8');
    expect(rendered).not.toContain('rpcallowip=0.0.0.0/0');
  });

  it('enables block notifications only when solo mining is enabled', () => {
    expect(
      renderApiConfig(
        { nodeEnableSoloMining: true },
        { lanCidrs: [] }
      )
    ).toContain('zmqpubhashblock=tcp://127.0.0.1:28332');
    expect(
      renderApiConfig(
        { nodeEnableSoloMining: false },
        { lanCidrs: [] }
      )
    ).not.toContain('zmqpubhashblock');
  });

  it('calculates interface CIDR values', () => {
    expect(interfaceToCidr('192.168.50.42', '255.255.255.0')).toBe(
      '192.168.50.0/24'
    );
    expect(interfaceToCidr('10.42.1.7', '255.255.0.0')).toBe('10.42.0.0/16');
    expect(isPrivateIpv4('192.168.50.42')).toBe(true);
    expect(isPrivateIpv4('203.0.113.42')).toBe(false);
    expect(
      getLanCidrs({
        eth0: [
          {
            family: 'IPv4',
            internal: false,
            address: '192.168.50.42',
            netmask: '255.255.255.0',
          },
        ],
        docker0: [
          {
            family: 'IPv4',
            internal: false,
            address: '172.17.0.1',
            netmask: '255.255.0.0',
          },
        ],
      })
    ).toEqual(['192.168.50.0/24']);
  });

  it('removes authentication and Apollo-owned options from user config', () => {
    const rendered = renderUserConfig({
      nodeUserConf: [
        'dbcache=1024',
        'rpcpassword=leak',
        'rpcauth=user:salt$hash',
        'includeconf=/tmp/override.conf',
        'maxconnections=999',
        'zmqpubhashblock=tcp://example.com:28332',
        'daemon=1',
        'noserver=1',
        'rpcport=18443',
        'chain=regtest',
      ].join('\n'),
    });

    expect(rendered).toContain('dbcache=1024');
    expect(rendered).not.toContain('leak');
    expect(rendered).not.toContain('rpcauth=');
    expect(rendered).not.toContain('includeconf=');
    expect(rendered).not.toContain('maxconnections=999');
    expect(rendered).not.toContain('zmqpubhashblock');
    expect(rendered).not.toContain('daemon=1');
    expect(rendered).not.toContain('noserver=1');
    expect(rendered).not.toContain('rpcport=18443');
    expect(rendered).not.toContain('chain=regtest');
  });

  it('gives ckpool only its dedicated credential', () => {
    const rendered = JSON.parse(
      renderCkpoolConfig(
        { btcsig: 'Apollo', startdiff: 2048, mindiff: 4 },
        credentials
      )
    );

    expect(rendered.btcd[0].auth).toBe('apollo-ckpool');
    expect(rendered.btcd[0].pass).toBe('pool-secret');
    expect(rendered.btcd[0].pass).not.toBe(credentials.lan.password);
  });
});

describe('RPC credential migration', () => {
  it('keeps the existing LAN password and creates a separate ckpool identity', async () => {
    await knex('settings').insert({
      miner_mode: 'balanced',
      voltage: 12,
      frequency: 650,
      node_rpc_password: 'existing-lan-secret',
      created_at: knex.fn.now(),
    });

    const credentials = await ensureRpcCredentials(knex, {
      stateDir: '/tmp/apollo-credential-test',
    });

    expect(credentials.lan.username).toBe('futurebit');
    expect(credentials.lan.password).toBe('existing-lan-secret');
    expect(credentials.ckpool.username).toBe('apollo-ckpool');
    expect(credentials.ckpool.password).not.toBe(credentials.lan.password);
    const persisted = JSON.parse(
      await fs.promises.readFile(
        '/tmp/apollo-credential-test/rpc-credentials.json',
        'utf8'
      )
    );
    expect(persisted.lan.password).toBe('existing-lan-secret');
    expect(validateCredentials(persisted)).toBe(true);

    await knex('settings').update({ node_rpc_password: 'stale-password' });
    const reloaded = await ensureRpcCredentials(knex, {
      stateDir: '/tmp/apollo-credential-test',
    });
    expect(reloaded.lan.password).toBe('existing-lan-secret');
    const settings = await knex('settings')
      .select('node_rpc_password')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .first();
    expect(settings.node_rpc_password).toBe('existing-lan-secret');
  });
});

describe('Bitcoin cookie parsing', () => {
  it('uses local cookie hosts only', () => {
    expect(isLocalRpcHost('127.0.0.1')).toBe(true);
    expect(isLocalRpcHost('localhost')).toBe(true);
    expect(isLocalRpcHost('::1')).toBe(true);
    expect(isLocalRpcHost('[::1]')).toBe(true);
    expect(isLocalRpcHost('192.168.1.10')).toBe(false);
  });

  it('preserves colons inside a cookie password', () => {
    expect(parseRpcCookie('__cookie__:secret:with:colons\n')).toEqual({
      username: '__cookie__',
      password: 'secret:with:colons',
    });
  });

  it('rejects malformed cookies', () => {
    expect(() => parseRpcCookie('missing-separator')).toThrow(
      'Bitcoin RPC cookie is malformed'
    );
  });

  it('builds the local RPC client from the cookie instead of the settings DB', async () => {
    fs.promises.readFile.mockResolvedValue('__cookie__:runtime-secret\n');
    const createClient = jest.spyOn(axios, 'create').mockReturnValue({});
    const originalHost = process.env.BITCOIN_NODE_HOST;
    const originalUser = process.env.BITCOIN_NODE_USER;
    const originalPass = process.env.BITCOIN_NODE_PASS;
    process.env.BITCOIN_NODE_USER = 'stale-local-user';
    process.env.BITCOIN_NODE_PASS = 'stale-local-password';
    process.env.BITCOIN_NODE_HOST = '127.0.0.1';

    try {
      await createNodeService(knex, {})._createRpcClient();
    } finally {
      if (originalHost === undefined) delete process.env.BITCOIN_NODE_HOST;
      else process.env.BITCOIN_NODE_HOST = originalHost;
      if (originalUser === undefined) delete process.env.BITCOIN_NODE_USER;
      else process.env.BITCOIN_NODE_USER = originalUser;
      if (originalPass === undefined) delete process.env.BITCOIN_NODE_PASS;
      else process.env.BITCOIN_NODE_PASS = originalPass;
    }

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: {
          username: '__cookie__',
          password: 'runtime-secret',
        },
      })
    );
  });

  it('uses explicit credentials for a remote RPC host', async () => {
    const createClient = jest.spyOn(axios, 'create').mockReturnValue({});
    const originalHost = process.env.BITCOIN_NODE_HOST;
    const originalUser = process.env.BITCOIN_NODE_USER;
    const originalPass = process.env.BITCOIN_NODE_PASS;
    process.env.BITCOIN_NODE_HOST = '192.0.2.10';
    process.env.BITCOIN_NODE_USER = 'remote-user';
    process.env.BITCOIN_NODE_PASS = 'remote-password';

    try {
      await createNodeService(knex, {})._createRpcClient();
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://192.0.2.10:8332',
          auth: {
            username: 'remote-user',
            password: 'remote-password',
          },
        })
      );
    } finally {
      if (originalHost === undefined) delete process.env.BITCOIN_NODE_HOST;
      else process.env.BITCOIN_NODE_HOST = originalHost;
      if (originalUser === undefined) delete process.env.BITCOIN_NODE_USER;
      else process.env.BITCOIN_NODE_USER = originalUser;
      if (originalPass === undefined) delete process.env.BITCOIN_NODE_PASS;
      else process.env.BITCOIN_NODE_PASS = originalPass;
    }
  });
});
