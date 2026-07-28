// tests/miner.test.js
const { knex } = require('../src/db');
const minerResolver = require('../src/graphql/resolvers/miner');

describe('Miner API', () => {
  beforeEach(async () => {
    // Reset service status before each test
    await knex('service_status').where({ service_name: 'miner' }).update({
      status: 'offline',
      requested_status: null,
      requested_at: null,
      last_checked: new Date()
    });
  });

  describe('Miner.online resolver', () => {
    it('should return online status when miner is running', async () => {
      // Mock miner service to simulate a running miner
      const mockMinerService = {
        checkOnline: jest.fn().mockResolvedValue({
          online: {
            status: 'online',
            timestamp: new Date().toISOString()
          }
        })
      };

      // Test resolver directly
      const result = await minerResolver.MinerActions.online(
        null,
        {},
        { services: { miner: mockMinerService } }
      );

      expect(result.result.online.status).toBe('online');
      expect(result.result.online.timestamp).toBeTruthy();
      expect(result.error).toBeNull();
    });

    it('should return offline status when miner is not running', async () => {
      // Mock miner service to simulate a stopped miner
      const mockMinerService = {
        checkOnline: jest.fn().mockResolvedValue({
          online: {
            status: 'offline',
            timestamp: new Date().toISOString()
          }
        })
      };

      // Test resolver directly
      const result = await minerResolver.MinerActions.online(
        null,
        {},
        { services: { miner: mockMinerService } }
      );

      expect(result.result.online.status).toBe('offline');
      expect(result.result.online.timestamp).toBeTruthy();
      expect(result.error).toBeNull();
    });

    it('should return pending status when miner start is requested', async () => {
      // Mock miner service to simulate a pending miner status
      const mockMinerService = {
        checkOnline: jest.fn().mockResolvedValue({
          online: {
            status: 'pending',
            timestamp: new Date().toISOString()
          }
        })
      };

      // Test resolver directly
      const result = await minerResolver.MinerActions.online(
        null,
        {},
        { services: { miner: mockMinerService } }
      );

      expect(result.result.online.status).toBe('pending');
      expect(result.result.online.timestamp).toBeTruthy();
      expect(result.error).toBeNull();
    });
  });

  describe('Miner.start resolver', () => {
    it('should request miner to start', async () => {
      // Mock miner service
      const mockMinerService = {
        start: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await minerResolver.MinerActions.start(
        null,
        {},
        { services: { miner: mockMinerService } }
      );

      expect(result.error).toBeNull();
      expect(mockMinerService.start).toHaveBeenCalled();
    });
  });

  describe('Miner.stop resolver', () => {
    it('should request miner to stop', async () => {
      // Mock miner service
      const mockMinerService = {
        stop: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await minerResolver.MinerActions.stop(
        null,
        {},
        { services: { miner: mockMinerService } }
      );

      expect(result.error).toBeNull();
      expect(mockMinerService.stop).toHaveBeenCalled();
    });
  });

  describe('Miner.restart resolver', () => {
    it('should request miner to restart', async () => {
      // Mock miner service
      const mockMinerService = {
        restart: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await minerResolver.MinerActions.restart(
        null,
        {},
        { services: { miner: mockMinerService } }
      );

      expect(result.error).toBeNull();
      expect(mockMinerService.restart).toHaveBeenCalled();
    });
  });

  describe('Miner.stats resolver', () => {
    it('should return miner statistics', async () => {
      // Mock miner service
      const mockMinerService = {
        getStats: jest.fn().mockResolvedValue({
          stats: [{
            date: new Date().toISOString(),
            version: 'v2.0.2',
            master: {
              boardsI: 36.5,
              boardsW: 250,
              intervals: {
                int_30: {
                  bySol: 7500,
                  byPool: 7450
                }
              }
            },
            pool: {
              host: 'stratum.example.com',
              port: 3333,
              userName: 'testuser.worker1'
            }
          }],
          ckpool: null
        })
      };

      // Test resolver directly
      const result = await minerResolver.MinerActions.stats(
        null,
        {},
        { services: { miner: mockMinerService } }
      );

      expect(result.result.stats).toBeTruthy();
      expect(result.result.stats.length).toBe(1);

      const stats = result.result.stats[0];
      expect(stats.master.boardsI).toBe(36.5);
      expect(stats.pool.host).toBe('stratum.example.com');

      expect(result.error).toBeNull();
    });

    it('should handle errors when fetching miner stats', async () => {
      // Mock miner service with error
      const mockMinerService = {
        getStats: jest.fn().mockRejectedValue(new Error('Failed to fetch stats'))
      };

      // Test resolver directly
      const result = await minerResolver.MinerActions.stats(
        null,
        {},
        { services: { miner: mockMinerService } }
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error.message).toContain('Failed to fetch stats');
    });
  });
});
// The miner rewrites its stat file continuously and reports fields it has no
// measurement for yet as empty strings. GraphQL cannot coerce "" into Float or
// Int, so on a real Apollo III a single miner restart — which every settings
// save triggers — replaced the whole miner page with
// "Float cannot represent non numeric value".
describe('stat file parsing tolerates a miner that has just restarted', () => {
  const fs = require('fs');

  const PARTIAL = {
    date: '2026-07-28 12:00:00',
    statVersion: '1.3',
    versions: { miner: '3.0.1', minerDate: '2026-07-28', minerDebug: '0', mspVer: '0x0' },
    master: {
      upTime: 2, diff: 2048, boards: 1, boardsI: '', boardsW: '',
      intervals: {
        30: { name: '30 sec', interval: 30, bySol: '', byPool: '', chipSpeed: '', chipRestarts: '' },
      },
    },
    pool: { host: 'x', port: '3333', userName: 'w', diff: 2048, intervals: { 0: { sharesSent: '' } } },
    fans: { 0: { rpm: [''] } },
    slots: { 0: { temperature: '', errorRate: '' } },
    slaves: [],
  };

  it('reports missing readings as null, which the schema allows, not as ""', async () => {
    // Only the Apollo III file exists, and it is the half-populated one a miner
    // writes in the seconds after it restarts.
    fs.promises.readdir.mockResolvedValueOnce([]);
    fs.promises.access.mockResolvedValueOnce(undefined);
    fs.promises.readFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(PARTIAL)));

    const minerService = require('../src/services/miner')(knex, {});
    const stats = await minerService._getMinerStats({}, []);
    const board = stats.find((s) => s.version === 'v3');

    expect(board).toBeDefined();
    expect(board.master.intervals.int_30.bySol).toBeNull();
    expect(board.master.intervals.int_30.chipRestarts).toBeNull();
    expect(board.slots.int_0.temperature).toBeNull();
    expect(board.master.boardsI).toBeNull();
    expect(board.fans.int_0.rpm).toEqual([null]);
    // Nothing left that GraphQL would refuse to coerce.
    expect(JSON.stringify(board)).not.toContain('""');
  });
});
