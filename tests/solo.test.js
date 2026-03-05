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

      await expect(SoloService.restart()).rejects.toThrow(
        'Solo pool restart timed out: service did not become active'
      );

      const row = await knex('service_status').where({ service_name: 'solo' }).first();
      expect(row).toBeDefined();
      expect(row.status).toBe('offline');
    });

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
