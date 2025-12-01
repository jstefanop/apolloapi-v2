const utils = require('../src/utils');

// Mock execWithSudo for testing
jest.mock('../src/utils', () => {
  const originalModule = jest.requireActual('../src/utils');
  return {
    ...originalModule,
    execWithSudo: jest.fn(),
    isProduction: jest.fn(() => false)
  };
});

describe('Bitcoin Software Switching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('switchBitcoinSoftware', () => {
    it('should validate target software correctly', async () => {
      const result = await utils.auth.switchBitcoinSoftware('invalid-software');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid software');
    });

    it('should handle core-28.1 software', async () => {
      const result = await utils.auth.switchBitcoinSoftware('core-28.1');
      expect(result.success).toBe(true);
      expect(result.message).toContain('core-28.1');
    });

    it('should handle core-25.1 software', async () => {
      const result = await utils.auth.switchBitcoinSoftware('core-25.1');
      expect(result.success).toBe(true);
      expect(result.message).toContain('core-25.1');
    });

    it('should handle knots-29.2 software', async () => {
      const result = await utils.auth.switchBitcoinSoftware('knots-29.2');
      expect(result.success).toBe(true);
      expect(result.message).toContain('knots-29.2');
    });

    it('should return dev mode message in development', async () => {
      const result = await utils.auth.switchBitcoinSoftware('core-28.1');
      expect(result.message).toContain('[DEV]');
    });
  });

  describe('manageBitcoinConf', () => {
    it('should handle settings without nodeSoftware', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeEnableTor: false,
        nodeUserConf: '',
        nodeEnableSoloMining: false,
        nodeMaxConnections: 64,
        nodeAllowLan: false,
        btcsig: 'test'
      };

      await expect(utils.auth.manageBitcoinConf(settings)).resolves.not.toThrow();
    });

    it('should handle settings with nodeSoftware', async () => {
      const settings = {
        nodeSoftware: 'core-28.1',
        nodeRpcPassword: 'test123',
        nodeEnableTor: false,
        nodeUserConf: '',
        nodeEnableSoloMining: false,
        nodeMaxConnections: 64,
        nodeAllowLan: false,
        btcsig: 'test'
      };

      await expect(utils.auth.manageBitcoinConf(settings)).resolves.not.toThrow();
    });
  });
});
