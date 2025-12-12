// tests/node.test.js
const { knex } = require('../src/db');
const nodeResolver = require('../src/graphql/resolvers/node');

describe('Node API', () => {
  beforeEach(async () => {
    // Reset service status before each test
    await knex('service_status').where({ service_name: 'node' }).update({
      status: 'offline',
      requested_status: null,
      requested_at: null,
      last_checked: new Date()
    });
  });

  describe('Node.online resolver', () => {
    it('should return online status when node is running', async () => {
      // Mock node service to simulate a running node
      const mockNodeService = {
        checkOnline: jest.fn().mockResolvedValue({
          online: {
            status: 'online',
            timestamp: new Date().toISOString()
          }
        })
      };

      // Test resolver directly
      const result = await nodeResolver.NodeActions.online(
        null,
        {},
        { services: { node: mockNodeService } }
      );

      expect(result.result.online.status).toBe('online');
      expect(result.result.online.timestamp).toBeTruthy();
      expect(result.error).toBeNull();
    });

    it('should return offline status when node is not running', async () => {
      // Mock node service to simulate a stopped node
      const mockNodeService = {
        checkOnline: jest.fn().mockResolvedValue({
          online: {
            status: 'offline',
            timestamp: new Date().toISOString()
          }
        })
      };

      // Test resolver directly
      const result = await nodeResolver.NodeActions.online(
        null,
        {},
        { services: { node: mockNodeService } }
      );

      expect(result.result.online.status).toBe('offline');
      expect(result.result.online.timestamp).toBeTruthy();
      expect(result.error).toBeNull();
    });
  });

  describe('Node.start resolver', () => {
    it('should request node to start', async () => {
      // Mock node service
      const mockNodeService = {
        start: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await nodeResolver.NodeActions.start(
        null,
        {},
        { services: { node: mockNodeService } }
      );

      expect(result.error).toBeNull();
      expect(mockNodeService.start).toHaveBeenCalled();
    });
  });

  describe('Node.stop resolver', () => {
    it('should request node to stop', async () => {
      // Mock node service
      const mockNodeService = {
        stop: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await nodeResolver.NodeActions.stop(
        null,
        {},
        { services: { node: mockNodeService } }
      );

      expect(result.error).toBeNull();
      expect(mockNodeService.stop).toHaveBeenCalled();
    });
  });

  describe('Node.stats resolver', () => {
    it('should return node statistics when node is running', async () => {
      // Mock node service with successful stats retrieval
      const mockNodeService = {
        getStats: jest.fn().mockResolvedValue({
          stats: {
            timestamp: new Date().toISOString(),
            blockchainInfo: {
              blocks: 123456,
              headers: 123458,
              sizeOnDisk: "350000000000"
            },
            connectionCount: 8,
            miningInfo: {
              difficulty: 48025038251.65,
              networkhashps: 347007400717329.4
            },
            peerInfo: [
              { addr: '192.168.1.1:8333', subver: '/Satoshi:23.0.0/' },
              { addr: '10.0.0.1:8333', subver: '/Bitcoin ABC:0.21.0/' }
            ],
            networkInfo: {
              version: '230000',
              subversion: '/Satoshi:23.0.0/',
              localaddresses: [
                { address: '192.168.1.100', port: 8333, score: 1 }
              ]
            }
          }
        })
      };

      // Test resolver directly
      const result = await nodeResolver.NodeActions.stats(
        null,
        {},
        { services: { node: mockNodeService } }
      );

      expect(result.result.stats).toBeTruthy();
      expect(result.result.stats.blockchainInfo.blocks).toBe(123456);
      expect(result.result.stats.connectionCount).toBe(8);
      expect(result.result.stats.peerInfo.length).toBe(2);
      expect(result.error).toBeNull();
    });

    it('should handle errors when fetching node stats', async () => {
      // Mock node service with error
      const mockNodeService = {
        getStats: jest.fn().mockResolvedValue({
          stats: {
            error: {
              code: 'CONNECTION_ERROR',
              message: 'Failed to connect to Bitcoin node'
            },
            timestamp: new Date().toISOString()
          }
        })
      };

      // Test resolver directly
      const result = await nodeResolver.NodeActions.stats(
        null,
        {},
        { services: { node: mockNodeService } }
      );

      expect(result.result.stats.error).toBeTruthy();
      expect(result.result.stats.error.message).toBe('Failed to connect to Bitcoin node');
      expect(result.error).toBeNull();
    });
  });

  describe('Node.conf resolver', () => {
    it('should return Bitcoin configuration', async () => {
      // Mock node service
      const mockNodeService = {
        getConf: jest.fn().mockResolvedValue({
          bitcoinConf: 'server=1\nrpcuser=futurebit\nrpcpassword=testpassword'
        })
      };

      // Test resolver directly
      const result = await nodeResolver.NodeActions.conf(
        null,
        {},
        { services: { node: mockNodeService } }
      );

      expect(result.result.bitcoinConf).toBeTruthy();
      expect(result.result.bitcoinConf).toContain('rpcuser=futurebit');
      expect(result.error).toBeNull();
    });
  });

  describe('Node.formatProgress resolver', () => {
    it('should return format progress', async () => {
      // Mock node service
      const mockNodeService = {
        getFormatProgress: jest.fn().mockResolvedValue({ value: 75 })
      };

      // Test resolver directly
      const result = await nodeResolver.NodeActions.formatProgress(
        null,
        {},
        { services: { node: mockNodeService } }
      );

      expect(result.result.value).toBe(75);
      expect(result.error).toBeNull();
    });

    it('should return 0 when progress file does not exist', async () => {
      // Mock node service with zero progress
      const mockNodeService = {
        getFormatProgress: jest.fn().mockResolvedValue({ value: 0 })
      };

      // Test resolver directly
      const result = await nodeResolver.NodeActions.formatProgress(
        null,
        {},
        { services: { node: mockNodeService } }
      );

      expect(result.result.value).toBe(0);
      expect(result.error).toBeNull();
    });
  });

  describe('Node.format resolver', () => {
    it('should request node disk formatting', async () => {
      // Mock node service
      const mockNodeService = {
        format: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await nodeResolver.NodeActions.format(
        null,
        {},
        { services: { node: mockNodeService } }
      );

      expect(result.error).toBeNull();
      expect(mockNodeService.format).toHaveBeenCalled();
    });
  });
});