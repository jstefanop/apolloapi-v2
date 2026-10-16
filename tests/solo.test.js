// tests/solo.test.js
const { exec } = require('child_process');

jest.mock('child_process', () => ({
  exec: jest.fn()
}));

const { knex } = require('../src/db');
const soloResolver = require('../src/graphql/resolvers/solo');
const SoloService = require('../src/services/solo')(knex, {});

describe('Solo API', () => {
  beforeEach(async () => {
    // Reset service status before each test
    await knex('service_status').where({ service_name: 'solo' }).update({
      status: 'offline',
      requested_status: null,
      requested_at: null,
      last_checked: new Date()
    });
  });

  describe('Solo.status resolver', () => {
    it('should return online status when solo pool is running', async () => {
      // Mock solo service to simulate a running solo pool
      const mockSoloService = {
        getStatus: jest.fn().mockResolvedValue('active')
      };

      // Test resolver directly
      const result = await soloResolver.SoloActions.status(
        null,
        {},
        { services: { solo: mockSoloService } }
      );

      expect(result.result.status).toBe('active');
      expect(result.error).toBeNull();
    });

    it('should return offline status when solo pool is not running', async () => {
      // Mock solo service to simulate a stopped solo pool
      const mockSoloService = {
        getStatus: jest.fn().mockResolvedValue('inactive')
      };

      // Test resolver directly
      const result = await soloResolver.SoloActions.status(
        null,
        {},
        { services: { solo: mockSoloService } }
      );

      expect(result.result.status).toBe('inactive');
      expect(result.error).toBeNull();
    });
  });

  describe('Solo.start resolver', () => {
    it('should request solo pool to start', async () => {
      // Mock solo service
      const mockSoloService = {
        start: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await soloResolver.SoloActions.start(
        null,
        {},
        { services: { solo: mockSoloService } }
      );

      expect(result.error).toBeNull();
      expect(mockSoloService.start).toHaveBeenCalled();
    });

    it('should handle start errors gracefully', async () => {
      // Mock solo service with error
      const mockSoloService = {
        start: jest.fn().mockRejectedValue(new Error('Start failed'))
      };

      // Test resolver directly
      const result = await soloResolver.SoloActions.start(
        null,
        {},
        { services: { solo: mockSoloService } }
      );

      expect(result.error).toBeTruthy();
      expect(result.error.message).toContain('Start failed');
    });
  });

  describe('Solo.stop resolver', () => {
    it('should request solo pool to stop', async () => {
      // Mock solo service
      const mockSoloService = {
        stop: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await soloResolver.SoloActions.stop(
        null,
        {},
        { services: { solo: mockSoloService } }
      );

      expect(result.error).toBeNull();
      expect(mockSoloService.stop).toHaveBeenCalled();
    });

    it('should handle stop errors gracefully', async () => {
      // Mock solo service with error
      const mockSoloService = {
        stop: jest.fn().mockRejectedValue(new Error('Stop failed'))
      };

      // Test resolver directly
      const result = await soloResolver.SoloActions.stop(
        null,
        {},
        { services: { solo: mockSoloService } }
      );

      expect(result.error).toBeTruthy();
      expect(result.error.message).toContain('Stop failed');
    });
  });

  describe('Solo.restart resolver', () => {
    it('should request solo pool to restart', async () => {
      // Mock solo service
      const mockSoloService = {
        restart: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await soloResolver.SoloActions.restart(
        null,
        {},
        { services: { solo: mockSoloService } }
      );

      expect(result.error).toBeNull();
      expect(mockSoloService.restart).toHaveBeenCalled();
    });

    it('should handle restart errors gracefully', async () => {
      // Mock solo service with error
      const mockSoloService = {
        restart: jest.fn().mockRejectedValue(new Error('Restart failed'))
      };

      // Test resolver directly
      const result = await soloResolver.SoloActions.restart(
        null,
        {},
        { services: { solo: mockSoloService } }
      );

      expect(result.error).toBeTruthy();
      expect(result.error.message).toContain('Restart failed');
    });
  });

  describe('Solo.stats resolver', () => {
    it('should return solo pool statistics', async () => {
      // Mock solo service with stats
      const mockStats = {
        status: 'active',
        pool: {
          runtime: 3600,
          Users: 5,
          Workers: 10,
          hashrate1m: '15.5T',
          hashrate1d: '450G'
        },
        users: [
          {
            hashrate1m: '15.5T',
            workers: 2,
            shares: 1000000
          }
        ],
        blockFound: false,
        timestamp: new Date().toISOString()
      };

      const mockSoloService = {
        getStats: jest.fn().mockResolvedValue(mockStats)
      };

      // Test resolver directly
      const result = await soloResolver.SoloActions.stats(
        null,
        {},
        { services: { solo: mockSoloService } }
      );

      expect(result.result).toEqual(mockStats);
      expect(result.error).toBeNull();
    });

    it('should handle stats errors gracefully', async () => {
      // Mock solo service with error
      const mockSoloService = {
        getStats: jest.fn().mockRejectedValue(new Error('Stats failed'))
      };

      // Test resolver directly
      const result = await soloResolver.SoloActions.stats(
        null,
        {},
        { services: { solo: mockSoloService } }
      );

      expect(result.error).toBeTruthy();
      expect(result.error.message).toContain('Stats failed');
    });
  });

  describe('SoloService.getStats', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('publishes an inactive status without reading ckpool files', async () => {
      jest.spyOn(SoloService, 'getStatus').mockResolvedValue('inactive');
      const getCkpoolStats = jest
        .spyOn(SoloService, '_getCkpoolStats')
        .mockResolvedValue({
          pool: { Workers: 1 },
          users: [{ workers: 1 }],
          blockFound: true,
        });

      const result = await SoloService.getStats();

      expect(getCkpoolStats).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'inactive',
        pool: null,
        users: [],
        blockFound: false,
        // Carried on every payload, stopped ckpool or not: it is the device's
        // record, not the current run's.
        bestShareEver: { value: expect.any(Number), at: null },
        timestamp: expect.any(String),
        error: null,
      });
    });

    it.each(['active', 'running'])(
      'reads ckpool files when the service status is %s',
      async (status) => {
        jest.spyOn(SoloService, 'getStatus').mockResolvedValue(status);
        const ckpoolData = {
          pool: { Workers: 1 },
          users: [{ workers: 1 }],
          blockFound: true,
        };
        const getCkpoolStats = jest
          .spyOn(SoloService, '_getCkpoolStats')
          .mockResolvedValue(ckpoolData);

        const result = await SoloService.getStats();

        expect(getCkpoolStats).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
          status,
          ...ckpoolData,
          bestShareEver: { value: expect.any(Number), at: null },
          timestamp: expect.any(String),
          error: null,
        });
      }
    );
  });

  describe('SoloService start/restart with _waitForActive (production)', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(async () => {
      const existing = await knex('service_status').where({ service_name: 'solo' }).first();
      if (!existing) {
        await knex('service_status').insert({
          service_name: 'solo',
          status: 'offline',
          requested_status: null,
          requested_at: null,
          last_checked: Date.now()
        });
      }
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      exec.mockReset();
    });

    it('restart() should set online only after service becomes active', async () => {
      process.env.NODE_ENV = 'production';
      let isActiveCallCount = 0;
      exec.mockImplementation((command, callback) => {
        if (command.includes('is-active')) {
          isActiveCallCount++;
          const stdout = isActiveCallCount < 3 ? 'inactive' : 'active';
          callback(null, stdout, '');
        } else if (command.includes('restart')) {
          callback(null, '', '');
        } else {
          callback(null, '', '');
        }
      });

      await SoloService.restart();

      const row = await knex('service_status').where({ service_name: 'solo' }).first();
      expect(row).toBeDefined();
      expect(row.status).toBe('online');
      expect(row.requested_status).toBe('online');
      expect(isActiveCallCount).toBe(3);
    });

    it('restart() should set offline and throw when service becomes failed', async () => {
      process.env.NODE_ENV = 'production';
      exec.mockImplementation((command, callback) => {
        if (command.includes('is-active')) {
          callback(null, 'failed', '');
        } else if (command.includes('restart')) {
          callback(null, '', '');
        } else {
          callback(null, '', '');
        }
      });

      await expect(SoloService.restart()).rejects.toMatchObject({
        message: 'Could not restart the solo pool',
        extensions: { code: 'SERVICE_COMMAND_FAILED', service: 'solo', action: 'restart' },
      });

      const row = await knex('service_status').where({ service_name: 'solo' }).first();
      expect(row).toBeDefined();
      expect(row.status).toBe('offline');
    });

    // The unit failed and systemd is in the 30 s auto-restart delay: ckpool is
    // about to come up, so the call must neither fail nor mark the pool offline.
    const timeoutWith = (show) => {
      exec.mockImplementation((command, callback) => {
        if (command.includes('show')) callback(null, show, '');
        else if (command.includes('is-active')) callback(null, 'activating', '');
        else callback(null, '', '');
      });
    };
    const rowStatus = async () =>
      (await knex('service_status').where({ service_name: 'solo' }).first()).status;

    it.each([
      ['restart', 'ActiveState=activating\nSubState=auto-restart\n'],
      ['start', 'ActiveState=activating\nSubState=auto-restart\n'],
      ['restart', 'ActiveState=deactivating\nSubState=stop-sigterm\n'],
    ])(
      '%s() leaves the row pending and does not throw when systemd is still working (%s)',
      async (action, show) => {
        process.env.NODE_ENV = 'production';
        timeoutWith(show);
        const spy = jest.spyOn(SoloService, '_waitForActive').mockResolvedValue(false);
        await expect(SoloService[action]()).resolves.toBeUndefined();
        spy.mockRestore();
        expect(await rowStatus()).toBe('pending');
      }
    );

    it.each(['restart', 'start'])(
      '%s() reports a localisable refusal and goes offline when the unit is down at timeout',
      async (action) => {
        process.env.NODE_ENV = 'production';
        timeoutWith('ActiveState=inactive\nSubState=dead\n');
        const spy = jest.spyOn(SoloService, '_waitForActive').mockResolvedValue(false);
        await expect(SoloService[action]()).rejects.toMatchObject({
          message: `Could not ${action} the solo pool`,
          extensions: { code: 'SERVICE_COMMAND_FAILED', service: 'solo', action },
        });
        spy.mockRestore();
        expect(await rowStatus()).toBe('offline');
      }
    );

    it('start() should set online only after service becomes active', async () => {
      process.env.NODE_ENV = 'production';
      exec.mockImplementation((command, callback) => {
        if (command.includes('is-active')) {
          callback(null, 'active', '');
        } else if (command.includes('start') && !command.includes('restart')) {
          callback(null, '', '');
        } else {
          callback(null, '', '');
        }
      });

      await SoloService.start();

      const row = await knex('service_status').where({ service_name: 'solo' }).first();
      expect(row).toBeDefined();
      expect(row.status).toBe('online');
    });
  });
});
