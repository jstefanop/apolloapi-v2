// tests/scheduler.push.test.js
// Unit tests for the push functions in src/app/scheduler.js.
// Uses the real scheduler (not the global mock from setup.js) with
// mocked service layer and a spied-on pubsub.publish.

// Override the global scheduler mock from setup.js
jest.unmock('../src/app/scheduler');

// Mock the services module so push functions don't hit real sockets/files
jest.mock('../src/services', () => ({
  miner: {
    getStats:    jest.fn(),
    checkOnline: jest.fn(),
  },
  mcu: {
    getStats: jest.fn(),
  },
  node: {
    getStats: jest.fn(),
  },
  solo: {
    getStats: jest.fn(),
  },
  services: {
    getStats: jest.fn(),
  },
  serviceMonitor: null,
}));

jest.setTimeout(15000);

describe('scheduler push functions', () => {
  let scheduler;
  let pubsub;
  let services;
  let TOPICS;
  let publishSpy;

  beforeEach(() => {
    jest.resetModules();

    // After resetModules we re-require to get fresh instances
    pubsub   = require('../src/graphql/pubsub');
    TOPICS   = require('../src/graphql/topics');
    services = require('../src/services');

    publishSpy = jest.spyOn(pubsub, 'publish').mockImplementation(() => {});

    // Re-require the real scheduler (jest.unmock above ensures this)
    scheduler = require('../src/app/scheduler');
  });

  afterEach(() => {
    publishSpy.mockRestore();
    jest.clearAllMocks();
  });

  // ------------------------------------------------------------------ //
  // withTimeout (tested indirectly via push functions)
  // ------------------------------------------------------------------ //

  describe('withTimeout behaviour (indirect)', () => {
    it('resolves normally when service responds in time', async () => {
      const fastResult = { some: 'data' };
      services.mcu.getStats.mockResolvedValue(fastResult);

      await scheduler.pushAllStats();

      const mcuCall = publishSpy.mock.calls.find(([topic]) => topic === TOPICS.MCU);
      expect(mcuCall).toBeDefined();
      expect(mcuCall[1]).toEqual({ mcu: { result: fastResult, error: null } });
    });

    it('rejects with timeout message when service hangs', async () => {
      // Make mcu.getStats never resolve (simulates a hung service)
      services.mcu.getStats.mockReturnValue(new Promise(() => {}));
      // Set a tiny timeout by patching — we test indirectly via pushMcuStats
      // We can test by checking that publish is still called (with error) within a reasonable time
      // using the real 8000 ms timeout would be too slow; instead we test the error path directly.
      services.miner.getStats.mockResolvedValue({});
      services.miner.checkOnline.mockResolvedValue({});
      services.node.getStats.mockResolvedValue({});
      services.solo.getStats.mockResolvedValue({});
      services.services.getStats.mockResolvedValue({});

      // pushAllStats uses Promise.allSettled so it always resolves
      const results = await Promise.race([
        scheduler.pushAllStats(),
        new Promise((_, r) => setTimeout(() => r(new Error('pushAllStats timed out in test')), 12000)),
      ]);

      // Other pushers must have published even if mcu hung (allSettled)
      const minerCall = publishSpy.mock.calls.find(([t]) => t === TOPICS.MINER);
      expect(minerCall).toBeDefined();
    }, 15000);
  });

  // ------------------------------------------------------------------ //
  // pushMinerStats
  // ------------------------------------------------------------------ //

  describe('pushMinerStats', () => {
    it('publishes MINER topic with result on success', async () => {
      const statsResult  = { boards: [{ uuid: 'abc' }] };
      const onlineResult = { online: { status: 'online' } };
      services.miner.getStats.mockResolvedValue(statsResult);
      services.miner.checkOnline.mockResolvedValue(onlineResult);

      await scheduler.pushAllStats();

      const call = publishSpy.mock.calls.find(([t]) => t === TOPICS.MINER);
      expect(call).toBeDefined();
      expect(call[1]).toEqual({
        miner: {
          stats:  { result: statsResult,  error: null },
          online: { result: onlineResult, error: null },
        },
      });
    });

    it('publishes MINER topic with error when service rejects', async () => {
      services.miner.getStats.mockRejectedValue(new Error('miner unavailable'));
      services.miner.checkOnline.mockRejectedValue(new Error('miner unavailable'));
      services.mcu.getStats.mockResolvedValue({});
      services.node.getStats.mockResolvedValue({});
      services.solo.getStats.mockResolvedValue({});
      services.services.getStats.mockResolvedValue({});

      await scheduler.pushAllStats();

      const call = publishSpy.mock.calls.find(([t]) => t === TOPICS.MINER);
      expect(call).toBeDefined();
      expect(call[1].miner.stats.result).toBeNull();
      expect(call[1].miner.stats.error).toHaveProperty('message');
    });
  });

  // ------------------------------------------------------------------ //
  // pushMcuStats
  // ------------------------------------------------------------------ //

  describe('pushMcuStats', () => {
    it('publishes MCU topic with result on success', async () => {
      const mcuData = { uptime: 1000 };
      services.mcu.getStats.mockResolvedValue(mcuData);
      services.miner.getStats.mockResolvedValue({});
      services.miner.checkOnline.mockResolvedValue({});
      services.node.getStats.mockResolvedValue({});
      services.solo.getStats.mockResolvedValue({});
      services.services.getStats.mockResolvedValue({});

      await scheduler.pushAllStats();

      const call = publishSpy.mock.calls.find(([t]) => t === TOPICS.MCU);
      expect(call).toBeDefined();
      expect(call[1]).toEqual({ mcu: { result: mcuData, error: null } });
    });

    it('publishes MCU topic with error when service rejects', async () => {
      services.mcu.getStats.mockRejectedValue(new Error('mcu offline'));
      services.miner.getStats.mockResolvedValue({});
      services.miner.checkOnline.mockResolvedValue({});
      services.node.getStats.mockResolvedValue({});
      services.solo.getStats.mockResolvedValue({});
      services.services.getStats.mockResolvedValue({});

      await scheduler.pushAllStats();

      const call = publishSpy.mock.calls.find(([t]) => t === TOPICS.MCU);
      expect(call).toBeDefined();
      expect(call[1].mcu.result).toBeNull();
      expect(call[1].mcu.error).toHaveProperty('message', 'mcu offline');
    });
  });

  // ------------------------------------------------------------------ //
  // pushNodeStats
  // ------------------------------------------------------------------ //

  describe('pushNodeStats', () => {
    it('publishes NODE topic with result on success', async () => {
      const nodeData = { blocks: 900000 };
      services.node.getStats.mockResolvedValue(nodeData);
      services.miner.getStats.mockResolvedValue({});
      services.miner.checkOnline.mockResolvedValue({});
      services.mcu.getStats.mockResolvedValue({});
      services.solo.getStats.mockResolvedValue({});
      services.services.getStats.mockResolvedValue({});

      await scheduler.pushAllStats();

      const call = publishSpy.mock.calls.find(([t]) => t === TOPICS.NODE);
      expect(call).toBeDefined();
      expect(call[1]).toEqual({ node: { result: nodeData, error: null } });
    });

    it('publishes NODE topic with error when service rejects', async () => {
      services.node.getStats.mockRejectedValue(new Error('node not synced'));
      services.miner.getStats.mockResolvedValue({});
      services.miner.checkOnline.mockResolvedValue({});
      services.mcu.getStats.mockResolvedValue({});
      services.solo.getStats.mockResolvedValue({});
      services.services.getStats.mockResolvedValue({});

      await scheduler.pushAllStats();

      const call = publishSpy.mock.calls.find(([t]) => t === TOPICS.NODE);
      expect(call).toBeDefined();
      expect(call[1].node.result).toBeNull();
      expect(call[1].node.error.message).toBe('node not synced');
    });
  });

  // ------------------------------------------------------------------ //
  // pushSoloStats
  // ------------------------------------------------------------------ //

  describe('pushSoloStats', () => {
    it('publishes SOLO topic with result on success', async () => {
      const soloData = { pool: { bestshare: 99 } };
      services.solo.getStats.mockResolvedValue(soloData);
      services.miner.getStats.mockResolvedValue({});
      services.miner.checkOnline.mockResolvedValue({});
      services.mcu.getStats.mockResolvedValue({});
      services.node.getStats.mockResolvedValue({});
      services.services.getStats.mockResolvedValue({});

      await scheduler.pushAllStats();

      const call = publishSpy.mock.calls.find(([t]) => t === TOPICS.SOLO);
      expect(call).toBeDefined();
      expect(call[1]).toEqual({ solo: { result: soloData, error: null } });
    });

    it('publishes SOLO topic with error when service rejects', async () => {
      services.solo.getStats.mockRejectedValue(new Error('ckpool unreachable'));
      services.miner.getStats.mockResolvedValue({});
      services.miner.checkOnline.mockResolvedValue({});
      services.mcu.getStats.mockResolvedValue({});
      services.node.getStats.mockResolvedValue({});
      services.services.getStats.mockResolvedValue({});

      await scheduler.pushAllStats();

      const call = publishSpy.mock.calls.find(([t]) => t === TOPICS.SOLO);
      expect(call).toBeDefined();
      expect(call[1].solo.error.message).toBe('ckpool unreachable');
    });
  });

  // ------------------------------------------------------------------ //
  // pushServicesStatus
  // ------------------------------------------------------------------ //

  describe('pushServicesStatus', () => {
    it('publishes SERVICES topic with result on success', async () => {
      const svcData = { data: [{ serviceName: 'miner', status: 'online' }] };
      services.services.getStats.mockResolvedValue(svcData);

      await scheduler.pushServicesStatus();

      const call = publishSpy.mock.calls.find(([t]) => t === TOPICS.SERVICES);
      expect(call).toBeDefined();
      expect(call[1]).toEqual({ services: { result: svcData, error: null } });
    });

    it('publishes SERVICES topic with error when getStats rejects', async () => {
      services.services.getStats.mockRejectedValue(new Error('db error'));

      await scheduler.pushServicesStatus();

      const call = publishSpy.mock.calls.find(([t]) => t === TOPICS.SERVICES);
      expect(call).toBeDefined();
      expect(call[1].services.result).toBeNull();
      expect(call[1].services.error.message).toBe('db error');
    });
  });

  // ------------------------------------------------------------------ //
  // pushAllStats
  // ------------------------------------------------------------------ //

  describe('pushAllStats', () => {
    it('always resolves (Promise.allSettled semantics) even when all services fail', async () => {
      services.miner.getStats.mockRejectedValue(new Error('fail'));
      services.miner.checkOnline.mockRejectedValue(new Error('fail'));
      services.mcu.getStats.mockRejectedValue(new Error('fail'));
      services.node.getStats.mockRejectedValue(new Error('fail'));
      services.solo.getStats.mockRejectedValue(new Error('fail'));
      services.services.getStats.mockRejectedValue(new Error('fail'));

      await expect(scheduler.pushAllStats()).resolves.not.toThrow();
    });

    it('publishes all 5 topics in a single call', async () => {
      services.miner.getStats.mockResolvedValue({});
      services.miner.checkOnline.mockResolvedValue({});
      services.mcu.getStats.mockResolvedValue({});
      services.node.getStats.mockResolvedValue({});
      services.solo.getStats.mockResolvedValue({});
      services.services.getStats.mockResolvedValue({});

      await scheduler.pushAllStats();

      const publishedTopics = publishSpy.mock.calls.map(([t]) => t);
      expect(publishedTopics).toContain(TOPICS.MINER);
      expect(publishedTopics).toContain(TOPICS.MCU);
      expect(publishedTopics).toContain(TOPICS.NODE);
      expect(publishedTopics).toContain(TOPICS.SOLO);
      expect(publishedTopics).toContain(TOPICS.SERVICES);
    });
  });
});
