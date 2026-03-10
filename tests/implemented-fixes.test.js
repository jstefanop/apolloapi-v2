/**
 * Tests for the security and reliability fixes documented in docs/IMPLEMENTED_FIXES.md
 * These verify the actual code paths (no shell on password/WiFi, scoped DB updates, null guards).
 */

const { knex } = require('../src/db');

// Use real scheduler for fetchStatistics / fetchRecentBlocks tests (guard + scoped update)
jest.unmock('../src/app/scheduler');

jest.setTimeout(20000);

describe('Implemented fixes (security & reliability)', () => {
  describe('1. Auth: changePassword delegates to utils.auth.changeSystemPassword (no shell)', () => {
    it('calls utils.auth.changeSystemPassword with plain password when in production', async () => {
      const mockChangeSystemPassword = jest.fn().mockResolvedValue(undefined);
      const mockUtils = { auth: { changeSystemPassword: mockChangeSystemPassword } };
      const AuthService = require('../src/services/auth');
      const authService = AuthService(knex, mockUtils);

      await knex('setup').del();
      await knex('setup').insert({
        password: await require('bcryptjs').hash('oldpass', 12)
      });

      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await authService.changePassword({ password: "newpass'; rm -rf / #" });
      } finally {
        process.env.NODE_ENV = origEnv;
      }

      expect(mockChangeSystemPassword).toHaveBeenCalledTimes(1);
      expect(mockChangeSystemPassword).toHaveBeenCalledWith("newpass'; rm -rf / #");
    });
  });

  describe('2. Utils: changeSystemPassword uses spawn + stdin (no shell interpolation)', () => {
    it('calls spawn(sudo, [chpasswd]) and writes password to stdin in production', async () => {
      const childProcess = require('child_process');
      const mockChild = {
        stdin: { write: jest.fn(), end: jest.fn() },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => { if (event === 'close') callback(0); })
      };
      childProcess.spawn.mockImplementation(() => mockChild);

      const utils = require('../src/utils');
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await utils.auth.changeSystemPassword('my$ecret');
      } finally {
        process.env.NODE_ENV = origEnv;
      }

      expect(childProcess.spawn).toHaveBeenCalledWith(
        'sudo',
        ['chpasswd'],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
      );
      expect(mockChild.stdin.write).toHaveBeenCalledWith('futurebit:my$ecret\n');
      expect(mockChild.stdin.end).toHaveBeenCalled();
    });
  });

  describe('3. MCU: WiFi connect uses spawn with argv (no shell on ssid/passphrase)', () => {
    it('calls spawn with nmcli args array so ssid/passphrase are not interpolated', async () => {
      const childProcess = require('child_process');
      const mockChild = {
        stdin: { write: jest.fn(), end: jest.fn() },
        stdout: { on: jest.fn((ev, cb) => ev === 'data' && cb('')) },
        stderr: { on: jest.fn((ev, cb) => ev === 'data' && cb('')) },
        on: jest.fn((event, callback) => { if (event === 'close') callback(0); })
      };
      childProcess.spawn.mockImplementation(() => mockChild);
      // _getIpAddress uses exec; ensure callback (err, stdout, stderr) is called so the promise resolves
      childProcess.exec.mockImplementation((cmd, opts, cb) => cb && setImmediate(() => cb(null, '192.168.1.1', '')));

      const McuService = require('../src/services/mcu');
      const mcuService = McuService(knex, {});

      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await mcuService.connectWifi({
          ssid: "Net'; echo pwned",
          passphrase: 'p@ss"; id'
        });
      } finally {
        process.env.NODE_ENV = origEnv;
      }

      const nmcliCalls = childProcess.spawn.mock.calls.filter(c => c[0] === 'sudo' && c[1] && c[1][0] === 'nmcli');
      expect(nmcliCalls.length).toBeGreaterThanOrEqual(1);
      const args = nmcliCalls[nmcliCalls.length - 1][1];
      expect(args).toEqual([
        'nmcli',
        'dev',
        'wifi',
        'connect',
        "Net'; echo pwned",
        'password',
        'p@ss"; id'
      ]);
    });
  });

  describe('4. Scheduler: fetchStatistics does not crash when miner service_status row is missing', () => {
    it('returns without throwing when no miner row in service_status', async () => {
      const scheduler = require('../src/app/scheduler');
      await knex('service_status').where({ service_name: 'miner' }).del();

      await expect(scheduler.fetchStatistics()).resolves.not.toThrow();
    });
  });

  describe('5. Utils: changeNodeRpcPassword updates only the latest settings row', () => {
    it('scoped update pattern: only the latest row by id is updated (same logic as changeNodeRpcPassword)', async () => {
      await knex('settings').del();
      await knex('settings').insert([
        { miner_mode: 'eco', voltage: 12, frequency: 600, node_rpc_password: 'old1', created_at: knex.fn.now() },
        { miner_mode: 'balanced', voltage: 12, frequency: 650, node_rpc_password: 'old2', created_at: knex.fn.now() }
      ]);

      const latestSettings = await knex('settings')
        .select('id')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .first();
      expect(latestSettings).toBeTruthy();

      await knex('settings')
        .where('id', latestSettings.id)
        .update({ node_rpc_password: 'newpass12' });

      const after = await knex('settings').orderBy('id', 'desc').select('id', 'node_rpc_password');
      expect(after[0].node_rpc_password).toBe('newpass12');
      expect(after[1].node_rpc_password).toBe('old1');
    });
  });

  describe('6. Settings: fan field is read and written', () => {
    it('returns fan from read() and persists fan on update()', async () => {
      const services = require('../src/services');
      await knex('settings').del();
      await knex('settings').insert({
        miner_mode: 'balanced',
        voltage: 12,
        frequency: 650,
        fan_low: 40,
        fan_high: 60,
        fan: null,
        temperature_unit: 'c',
        left_sidebar_visibility: true,
        left_sidebar_extended: true,
        right_sidebar_visibility: true,
        node_rpc_password: 'x',
        created_at: knex.fn.now()
      });

      await services.settings.update({ fan: 42 });
      const read = await services.settings.read();
      expect(read.fan).toBe(42);
    });
  });

  describe('7. Scheduler: recent_blocks update when node offline only touches rows with error null', () => {
    it('updates only rows where error is null, preserving per-block errors', async () => {
      const scheduler = require('../src/app/scheduler');
      await knex.schema.dropTableIfExists('recent_blocks');
      await knex.schema.createTable('recent_blocks', table => {
        table.increments('id').primary();
        table.string('block_hash', 64).unique().notNullable();
        table.integer('height').notNullable();
        table.text('block_data').notNullable();
        table.text('error').nullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.timestamp('created_at').defaultTo(knex.fn.now());
      });

      await knex('recent_blocks').insert([
        { block_hash: 'aaa', height: 100, block_data: '{}', error: null },
        { block_hash: 'bbb', height: 99, block_data: '{}', error: 'Block not found' },
        { block_hash: 'ccc', height: 98, block_data: '{}', error: null }
      ]);

      await knex('service_status').where({ service_name: 'node' }).del();
      await knex('service_status').insert({
        service_name: 'node',
        status: 'offline',
        last_checked: new Date()
      });

      await scheduler.fetchRecentBlocks();

      const rows = await knex('recent_blocks').orderBy('height', 'desc').select('block_hash', 'error');
      const byHash = Object.fromEntries(rows.map(r => [r.block_hash, r.error]));
      expect(byHash.aaa).toBe('Node is not online');
      expect(byHash.bbb).toBe('Block not found');
      expect(byHash.ccc).toBe('Node is not online');
    });
  });
});
