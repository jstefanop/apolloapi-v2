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

    it('should handle core-latest software', async () => {
      const result = await utils.auth.switchBitcoinSoftware('core-latest');
      expect(result.success).toBe(true);
      expect(result.message).toContain('core-latest');
    });

    it('should handle knots-latest software', async () => {
      const result = await utils.auth.switchBitcoinSoftware('knots-latest');
      expect(result.success).toBe(true);
      expect(result.message).toContain('knots-latest');
    });

    it('should return dev mode message in development', async () => {
      const result = await utils.auth.switchBitcoinSoftware('core-latest');
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
        nodeSoftware: 'core-latest',
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
