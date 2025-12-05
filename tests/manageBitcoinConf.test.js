const utils = require('../src/utils');
const fs = require('fs').promises;

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    access: jest.fn()
  }
}));

// Mock child_process for execWithSudo
jest.mock('child_process', () => ({
  exec: jest.fn((cmd, callback) => {
    if (callback) callback(null, { stdout: 'success' });
    return { stdout: 'success' };
  })
}));

describe('manageBitcoinConf', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset mocks
    fs.mkdir.mockResolvedValue();
    fs.readFile.mockRejectedValue(new Error('File not found'));
    fs.writeFile.mockResolvedValue();
  });

  // Helper to get written content for a specific file
  const getWrittenContent = (filename) => {
    const calls = fs.writeFile.mock.calls;
    const call = calls.find(c => c[0].includes(filename));
    return call ? call[1] : null;
  };

  describe('api.conf Generation', () => {
    it('should create api.conf with rpcpassword', async () => {
      const settings = {
        nodeRpcPassword: 'test123'
      };

      await utils.auth.manageBitcoinConf(settings);

      const apiConf = getWrittenContent('api.conf');
      expect(apiConf).not.toBeNull();
      expect(apiConf).toContain('# API managed Bitcoin configuration');
      expect(apiConf).toContain('rpcpassword=test123');
    });

    it('should use default_password when nodeRpcPassword is not provided', async () => {
      const settings = {};

      await utils.auth.manageBitcoinConf(settings);

      const apiConf = getWrittenContent('api.conf');
      expect(apiConf).toContain('rpcpassword=default_password');
    });

    it('should include Tor configuration when enabled', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeEnableTor: true
      };

      await utils.auth.manageBitcoinConf(settings);

      const apiConf = getWrittenContent('api.conf');
      expect(apiConf).toContain('proxy=127.0.0.1:9050');
      expect(apiConf).toContain('listen=1');
      expect(apiConf).toContain('bind=127.0.0.1');
      expect(apiConf).toContain('onlynet=onion');
      expect(apiConf).toContain('dnsseed=0');
      expect(apiConf).toContain('dns=0');
    });

    it('should not include Tor configuration when disabled', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeEnableTor: false
      };

      await utils.auth.manageBitcoinConf(settings);

      const apiConf = getWrittenContent('api.conf');
      expect(apiConf).not.toContain('proxy=127.0.0.1:9050');
      expect(apiConf).not.toContain('onlynet=onion');
    });

    it('should include maxconnections when provided', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeMaxConnections: 128
      };

      await utils.auth.manageBitcoinConf(settings);

      const apiConf = getWrittenContent('api.conf');
      expect(apiConf).toContain('maxconnections=128');
    });

    it('should not include maxconnections when not provided', async () => {
      const settings = {
        nodeRpcPassword: 'test123'
      };

      await utils.auth.manageBitcoinConf(settings);

      const apiConf = getWrittenContent('api.conf');
      expect(apiConf).not.toContain('maxconnections');
    });

    it('should include LAN access settings when enabled', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeAllowLan: true
      };

      await utils.auth.manageBitcoinConf(settings);

      const apiConf = getWrittenContent('api.conf');
      expect(apiConf).toContain('rpcbind=0.0.0.0');
      expect(apiConf).toContain('rpcallowip=0.0.0.0/0');
    });

    it('should not include LAN access settings when disabled', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeAllowLan: false
      };

      await utils.auth.manageBitcoinConf(settings);

      const apiConf = getWrittenContent('api.conf');
      expect(apiConf).not.toContain('rpcbind=0.0.0.0');
      expect(apiConf).not.toContain('rpcallowip=0.0.0.0/0');
    });
  });

  describe('user.conf Generation', () => {
    it('should create user.conf with default header when no user config', async () => {
      const settings = {
        nodeRpcPassword: 'test123'
      };

      await utils.auth.manageBitcoinConf(settings);

      const userConf = getWrittenContent('user.conf');
      expect(userConf).not.toBeNull();
      expect(userConf).toContain('# User custom Bitcoin configuration');
    });

    it('should include user configuration when provided', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeUserConf: 'addnode=1.2.3.4\nmaxuploadtarget=5000'
      };

      await utils.auth.manageBitcoinConf(settings);

      const userConf = getWrittenContent('user.conf');
      expect(userConf).toContain('addnode=1.2.3.4');
      expect(userConf).toContain('maxuploadtarget=5000');
    });

    it('should filter out excluded options from user configuration', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeUserConf: 'addnode=1.2.3.4\nrpcallowip=0.0.0.0\nrpcbind=0.0.0.0\nmaxconnections=100'
      };

      await utils.auth.manageBitcoinConf(settings);

      const userConf = getWrittenContent('user.conf');
      expect(userConf).toContain('addnode=1.2.3.4');
      // Excluded options should NOT be in user.conf
      expect(userConf).not.toContain('rpcallowip=0.0.0.0');
      expect(userConf).not.toContain('rpcbind=0.0.0.0');
      expect(userConf).not.toContain('maxconnections=100');
    });

    it('should filter out Tor-related options from user configuration', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeUserConf: 'addnode=1.2.3.4\nproxy=socks5://custom\nlisten=0\nbind=192.168.1.1'
      };

      await utils.auth.manageBitcoinConf(settings);

      const userConf = getWrittenContent('user.conf');
      expect(userConf).toContain('addnode=1.2.3.4');
      // Tor-related options should be filtered
      expect(userConf).not.toContain('proxy=');
      expect(userConf).not.toContain('listen=');
      expect(userConf).not.toContain('bind=');
    });

    it('should preserve comments in user configuration', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeUserConf: '# My custom settings\naddnode=1.2.3.4\n# Another comment'
      };

      await utils.auth.manageBitcoinConf(settings);

      const userConf = getWrittenContent('user.conf');
      expect(userConf).toContain('# My custom settings');
      expect(userConf).toContain('addnode=1.2.3.4');
      expect(userConf).toContain('# Another comment');
    });
  });

  describe('File Writing Behavior', () => {
    it('should not write api.conf if content has not changed', async () => {
      const settings = {
        nodeRpcPassword: 'test123'
      };

      // Mock existing file with same content
      fs.readFile.mockImplementation((path) => {
        if (path.includes('api.conf')) {
          return Promise.resolve('# API managed Bitcoin configuration\nrpcpassword=test123\n');
        }
        return Promise.reject(new Error('File not found'));
      });

      await utils.auth.manageBitcoinConf(settings);

      // api.conf should not be written (no changes)
      const apiConfWritten = fs.writeFile.mock.calls.some(c => c[0].includes('api.conf'));
      expect(apiConfWritten).toBe(false);
    });

    it('should write api.conf if content has changed', async () => {
      const settings = {
        nodeRpcPassword: 'newpassword'
      };

      // Mock existing file with different content
      fs.readFile.mockImplementation((path) => {
        if (path.includes('api.conf')) {
          return Promise.resolve('# API managed Bitcoin configuration\nrpcpassword=oldpassword\n');
        }
        return Promise.reject(new Error('File not found'));
      });

      await utils.auth.manageBitcoinConf(settings);

      const apiConf = getWrittenContent('api.conf');
      expect(apiConf).toContain('rpcpassword=newpassword');
    });

    it('should create directories if they do not exist', async () => {
      const settings = {
        nodeRpcPassword: 'test123'
      };

      await utils.auth.manageBitcoinConf(settings);

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('backend/node'),
        { recursive: true }
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle missing settings gracefully', async () => {
      await utils.auth.manageBitcoinConf(null);

      // Should not write any files
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle directory creation errors gracefully', async () => {
      fs.mkdir.mockRejectedValue(new Error('Permission denied'));

      const settings = {
        nodeRpcPassword: 'test123'
      };

      // Should not throw
      await expect(utils.auth.manageBitcoinConf(settings)).resolves.not.toThrow();
    });

    it('should handle file read errors gracefully', async () => {
      fs.readFile.mockRejectedValue(new Error('Permission denied'));

      const settings = {
        nodeRpcPassword: 'test123'
      };

      // Should not throw and should write new files
      await expect(utils.auth.manageBitcoinConf(settings)).resolves.not.toThrow();
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('Complex Configuration Scenarios', () => {
    it('should handle all settings enabled', async () => {
      const settings = {
        nodeRpcPassword: 'complex_pass_123',
        nodeEnableTor: true,
        nodeEnableSoloMining: true,
        nodeAllowLan: true,
        nodeMaxConnections: 256,
        nodeUserConf: 'addnode=1.2.3.4\nmaxuploadtarget=10000',
        btcsig: 'Custom Signature'
      };

      await utils.auth.manageBitcoinConf(settings);

      // Check api.conf
      const apiConf = getWrittenContent('api.conf');
      expect(apiConf).toContain('rpcpassword=complex_pass_123');
      expect(apiConf).toContain('maxconnections=256');
      expect(apiConf).toContain('rpcbind=0.0.0.0');
      expect(apiConf).toContain('proxy=127.0.0.1:9050');
      expect(apiConf).toContain('onlynet=onion');

      // Check user.conf
      const userConf = getWrittenContent('user.conf');
      expect(userConf).toContain('addnode=1.2.3.4');
      expect(userConf).toContain('maxuploadtarget=10000');
    });

    it('should handle minimal settings', async () => {
      const settings = {
        nodeRpcPassword: 'simple_pass'
      };

      await utils.auth.manageBitcoinConf(settings);

      // Check api.conf has minimal content
      const apiConf = getWrittenContent('api.conf');
      expect(apiConf).toContain('# API managed Bitcoin configuration');
      expect(apiConf).toContain('rpcpassword=simple_pass');
      expect(apiConf).not.toContain('maxconnections');
      expect(apiConf).not.toContain('rpcbind');
      expect(apiConf).not.toContain('proxy');

      // Check user.conf has default header only
      const userConf = getWrittenContent('user.conf');
      expect(userConf).toBe('# User custom Bitcoin configuration\n');
    });

    it('should handle Tor enabled with LAN access', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeEnableTor: true,
        nodeAllowLan: true
      };

      await utils.auth.manageBitcoinConf(settings);

      const apiConf = getWrittenContent('api.conf');
      // Both Tor and LAN settings should be present
      expect(apiConf).toContain('proxy=127.0.0.1:9050');
      expect(apiConf).toContain('rpcbind=0.0.0.0');
      expect(apiConf).toContain('rpcallowip=0.0.0.0/0');
    });
  });

  describe('ckpool Configuration', () => {
    it('should call manageCkpoolConf with settings', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        btcsig: 'Test Signature'
      };

      // Spy on manageCkpoolConf
      const originalManageCkpoolConf = utils.auth.manageCkpoolConf;
      utils.auth.manageCkpoolConf = jest.fn().mockResolvedValue();

      await utils.auth.manageBitcoinConf(settings);

      expect(utils.auth.manageCkpoolConf).toHaveBeenCalledWith(settings);

      // Restore
      utils.auth.manageCkpoolConf = originalManageCkpoolConf;
    });
  });
});
