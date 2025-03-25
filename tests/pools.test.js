// tests/pools.test.js
const { knex } = require('../src/db');
const poolsResolver = require('../src/graphql/resolvers/pools');

describe('Pools API', () => {
  beforeEach(async () => {
    // Clear pools table before each test
    await knex('pools').del();
  });

  describe('Pool.list resolver', () => {
    it('should return an empty list when no pools exist', async () => {
      // Mock pools service
      const mockPoolsService = {
        list: jest.fn().mockResolvedValue({ pools: [] })
      };

      // Test resolver directly
      const result = await poolsResolver.PoolActions.list(
        null,
        {},
        { services: { pools: mockPoolsService } }
      );

      expect(result.result.pools).toEqual([]);
      expect(result.error).toBeNull();
    });

    it('should list all pools', async () => {
      // Mock pools service with sample pools
      const mockPools = [
        {
          id: 1,
          url: 'stratum.slushpool.com:3333',
          username: 'user1',
          enabled: true,
          index: 1
        },
        {
          id: 2,
          url: 'eu.stratum.slushpool.com:3333',
          username: 'user2',
          enabled: true,
          index: 2
        }
      ];

      const mockPoolsService = {
        list: jest.fn().mockResolvedValue({ pools: mockPools })
      };

      // Test resolver directly
      const result = await poolsResolver.PoolActions.list(
        null,
        {},
        { services: { pools: mockPoolsService } }
      );

      expect(result.result.pools.length).toBe(2);
      expect(result.result.pools[0].url).toBe('stratum.slushpool.com:3333');
      expect(result.result.pools[1].url).toBe('eu.stratum.slushpool.com:3333');
      expect(result.error).toBeNull();
    });
  });

  describe('Pool.create resolver', () => {
    it('should create a new pool', async () => {
      // Mock pools service
      const mockPoolInput = {
        enabled: true,
        url: 'stratum.antpool.com:3333',
        username: 'testuser',
        password: 'x',
        index: 1
      };

      const mockCreatedPool = {
        id: 1,
        ...mockPoolInput
      };

      const mockPoolsService = {
        create: jest.fn().mockResolvedValue({ pool: mockCreatedPool })
      };

      // Test resolver directly
      const result = await poolsResolver.PoolActions.create(
        null,
        { input: mockPoolInput },
        { services: { pools: mockPoolsService } }
      );

      expect(result.result.pool).toMatchObject(mockCreatedPool);
      expect(result.error).toBeNull();
      expect(mockPoolsService.create).toHaveBeenCalledWith(mockPoolInput);
    });

    it('should handle pool creation errors', async () => {
      // Mock pools service with error
      const mockPoolInput = {
        enabled: true,
        url: 'stratum.example.com:3333'
      };

      const mockPoolsService = {
        create: jest.fn().mockRejectedValue(new Error('Invalid pool configuration'))
      };

      // Test resolver directly
      const result = await poolsResolver.PoolActions.create(
        null,
        { input: mockPoolInput },
        { services: { pools: mockPoolsService } }
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error.message).toBe('Invalid pool configuration');
    });
  });

  describe('Pool.update resolver', () => {
    it('should update an existing pool', async () => {
      // Mock pools service
      const mockPoolUpdateInput = {
        id: 1,
        enabled: false,
        url: 'stratum.f2pool.com:3333',
        username: 'updated-user'
      };

      const mockUpdatedPool = {
        id: 1,
        ...mockPoolUpdateInput
      };

      const mockPoolsService = {
        update: jest.fn().mockResolvedValue({ pool: mockUpdatedPool })
      };

      // Test resolver directly
      const result = await poolsResolver.PoolActions.update(
        null,
        { input: mockPoolUpdateInput },
        { services: { pools: mockPoolsService } }
      );

      expect(result.result.pool).toMatchObject(mockUpdatedPool);
      expect(result.error).toBeNull();
      expect(mockPoolsService.update).toHaveBeenCalledWith(mockPoolUpdateInput);
    });

    it('should handle pool update errors', async () => {
      // Mock pools service with error
      const mockPoolUpdateInput = {
        id: 999,
        url: 'stratum.example.com:3333'
      };

      const mockPoolsService = {
        update: jest.fn().mockRejectedValue(new Error('Pool not found'))
      };

      // Test resolver directly
      const result = await poolsResolver.PoolActions.update(
        null,
        { input: mockPoolUpdateInput },
        { services: { pools: mockPoolsService } }
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error.message).toBe('Pool not found');
    });
  });

  describe('Pool.updateAll resolver', () => {
    it('should update multiple pools', async () => {
      // Mock pools service
      const mockPoolsInput = {
        pools: [
          {
            index: 1,
            enabled: true,
            url: 'stratum.new1.com:3333',
            username: 'user1-new'
          },
          {
            index: 2,
            enabled: false,
            url: 'stratum.new2.com:3333',
            username: 'user2-new'
          }
        ]
      };

      const mockUpdatedPools = mockPoolsInput.pools.map((pool, index) => ({
        id: index + 1,
        ...pool
      }));

      const mockPoolsService = {
        updateAll: jest.fn().mockResolvedValue({ pools: mockUpdatedPools })
      };

      // Test resolver directly
      const result = await poolsResolver.PoolActions.updateAll(
        null,
        { input: mockPoolsInput },
        { services: { pools: mockPoolsService } }
      );

      expect(result.result.pools.length).toBe(2);
      expect(result.result.pools[0].url).toBe('stratum.new1.com:3333');
      expect(result.result.pools[1].url).toBe('stratum.new2.com:3333');
      expect(result.error).toBeNull();
      expect(mockPoolsService.updateAll).toHaveBeenCalledWith(mockPoolsInput.pools);
    });

    it('should handle updateAll errors', async () => {
      // Mock pools service with error
      const mockPoolsInput = {
        pools: [
          {
            index: 1,
            url: 'stratum.example.com:3333'
          }
        ]
      };

      const mockPoolsService = {
        updateAll: jest.fn().mockRejectedValue(new Error('Failed to update pools'))
      };

      // Test resolver directly
      const result = await poolsResolver.PoolActions.updateAll(
        null,
        { input: mockPoolsInput },
        { services: { pools: mockPoolsService } }
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error.message).toBe('Failed to update pools');
    });
  });

  describe('Pool.delete resolver', () => {
    it('should delete a pool', async () => {
      // Mock pools service
      const mockPoolDeleteInput = { id: 1 };

      const mockPoolsService = {
        delete: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await poolsResolver.PoolActions.delete(
        null,
        { input: mockPoolDeleteInput },
        { services: { pools: mockPoolsService } }
      );

      expect(result.error).toBeNull();
      expect(mockPoolsService.delete).toHaveBeenCalledWith(mockPoolDeleteInput);
    });

    it('should handle pool deletion errors', async () => {
      // Mock pools service with error
      const mockPoolDeleteInput = { id: 999 };

      const mockPoolsService = {
        delete: jest.fn().mockRejectedValue(new Error('Pool not found'))
      };

      // Test resolver directly
      const result = await poolsResolver.PoolActions.delete(
        null,
        { input: mockPoolDeleteInput },
        { services: { pools: mockPoolsService } }
      );

      expect(result.error).toBeTruthy();
      expect(result.error.message).toBe('Pool not found');
    });
  });
});