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

// Mock execWithSudo and other functions
jest.mock('../src/utils', () => {
  const originalModule = jest.requireActual('../src/utils');
  return {
    ...originalModule,
    auth: {
      ...originalModule.auth,
      execWithSudo: jest.fn(),
      manageCkpoolConf: jest.fn(),
      getSystemNetwork: jest.fn(() => '192.168.1.0/24'),
      switchBitcoinSoftware: jest.fn()
    }
  };
});

describe('manageBitcoinConf', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset mocks
    fs.mkdir.mockResolvedValue();
    fs.readFile.mockRejectedValue(new Error('File not found'));
    fs.writeFile.mockResolvedValue();
    
    // Mock utils functions
    utils.auth.execWithSudo.mockResolvedValue('success');
    utils.auth.manageCkpoolConf.mockResolvedValue();
    utils.auth.switchBitcoinSoftware.mockResolvedValue({ success: true, message: 'Switched successfully' });
    utils.auth.getSystemNetwork.mockReturnValue('192.168.1.0/24');
  });

  describe('Basic Configuration', () => {
    it('should create basic configuration with minimal settings', async () => {
      const settings = {
        nodeRpcPassword: 'test123'
      };

      await utils.auth.manageBitcoinConf(settings);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('bitcoin.conf'),
        expect.stringContaining('server=1'),
        'utf8'
      );
    });

    it('should include RPC user and password in configuration', async () => {
      const settings = {
        nodeRpcPassword: 'secure_password_123'
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('rpcuser=futurebit');
      expect(writtenContent).toContain('rpcpassword=secure_password_123');
    });

    it('should include default Bitcoin settings', async () => {
      const settings = {
        nodeRpcPassword: 'test123'
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('daemon=0');
      expect(writtenContent).toContain('upnp=1');
      expect(writtenContent).toContain('uacomment=FutureBit-Apollo-Node');
    });
  });

  describe('Solo Mining Configuration', () => {
    it('should include ZMQ configuration for solo mining', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeEnableSoloMining: true
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('zmqpubhashblock=tcp://127.0.0.1:28332');
    });
  });

  describe('Tor Configuration', () => {
    it('should include Tor configuration in bitcoin.conf when enabled', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeEnableTor: true
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('proxy=127.0.0.1:9050');
      expect(writtenContent).toContain('listen=1');
      expect(writtenContent).toContain('bind=127.0.0.1');
      expect(writtenContent).toContain('onlynet=onion');
      expect(writtenContent).toContain('dnsseed=0');
      expect(writtenContent).toContain('dns=0');
    });

    it('should not include Tor configuration when disabled', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeEnableTor: false
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).not.toContain('proxy=127.0.0.1:9050');
    });
  });

  describe('LAN Access Configuration', () => {
    it('should allow LAN access when nodeAllowLan is true', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeAllowLan: true
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('rpcbind=0.0.0.0');
      expect(writtenContent).toContain('rpcallowip=0.0.0.0/0');
    });

    it('should not allow LAN access when nodeAllowLan is false', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeAllowLan: false
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).not.toContain('rpcbind=0.0.0.0');
      expect(writtenContent).not.toContain('rpcallowip=0.0.0.0/0');
    });
  });

  describe('Max Connections Configuration', () => {
    it('should set custom max connections when provided', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeMaxConnections: 128
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('maxconnections=128');
    });

    it('should set default max connections to 64 when not provided', async () => {
      const settings = {
        nodeRpcPassword: 'test123'
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('maxconnections=64');
    });
  });

  describe('User Configuration', () => {
    it('should include user configuration when provided', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeUserConf: 'addnode=1.2.3.4\nmaxuploadtarget=5000'
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('#USER_INPUT_START');
      expect(writtenContent).toContain('addnode=1.2.3.4');
      expect(writtenContent).toContain('maxuploadtarget=5000');
      expect(writtenContent).toContain('#USER_INPUT_END');
    });

    it('should filter out excluded options from user configuration', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeUserConf: 'addnode=1.2.3.4\nrpcallowip=0.0.0.0\nrpcbind=0.0.0.0'
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('addnode=1.2.3.4');
      expect(writtenContent).not.toContain('rpcallowip=0.0.0.0');
      expect(writtenContent).not.toContain('rpcbind=0.0.0.0');
    });

    it('should handle empty user configuration', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeUserConf: ''
      };

      await utils.auth.manageBitcoinConf(settings);

      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).not.toContain('#USER_INPUT_START');
      expect(writtenContent).not.toContain('#USER_INPUT_END');
    });
  });

  describe('Bitcoin Software Switching', () => {
    it('should call switchBitcoinSoftware when nodeSoftware is provided', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeSoftware: 'knots-latest'
      };

      await utils.auth.manageBitcoinConf(settings);

      expect(utils.auth.switchBitcoinSoftware).toHaveBeenCalledWith('knots-latest');
    });

    it('should continue with configuration even if software switch fails', async () => {
      const settings = {
        nodeRpcPassword: 'test123',
        nodeSoftware: 'core-latest'
      };

      utils.auth.switchBitcoinSoftware.mockResolvedValue({ 
        success: false, 
        message: 'Switch failed' 
      });

      await utils.auth.manageBitcoinConf(settings);

      // Should still write configuration file
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('Configuration File Handling', () => {
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

    it('should handle existing configuration file', async () => {
      const existingConfig = 'server=1\nrpcuser=futurebit\nrpcpassword=oldpass';
      fs.readFile.mockResolvedValue(existingConfig);

      const settings = {
        nodeRpcPassword: 'newpass'
      };

      await utils.auth.manageBitcoinConf(settings);

      expect(fs.readFile).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing settings gracefully', async () => {
      await utils.auth.manageBitcoinConf(null);

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle directory creation errors', async () => {
      fs.mkdir.mockRejectedValue(new Error('Permission denied'));

      const settings = {
        nodeRpcPassword: 'test123'
      };

      await utils.auth.manageBitcoinConf(settings);

      // Should continue and try to write file
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
        nodeSoftware: 'knots-latest'
      };

      await utils.auth.manageBitcoinConf(settings);

      // Should call software switch
      expect(utils.auth.switchBitcoinSoftware).toHaveBeenCalledWith('knots-latest');

      // Should write configuration with all features
      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('maxconnections=256');
      expect(writtenContent).toContain('rpcbind=0.0.0.0');
      expect(writtenContent).toContain('proxy=127.0.0.1:9050');
      expect(writtenContent).toContain('addnode=1.2.3.4');
      expect(writtenContent).toContain('zmqpubhashblock=tcp://127.0.0.1:28332');
    });

    it('should handle all settings disabled', async () => {
      const settings = {
        nodeRpcPassword: 'simple_pass',
        nodeEnableTor: false,
        nodeEnableSoloMining: false,
        nodeAllowLan: false,
        nodeMaxConnections: null,
        nodeUserConf: null,
        nodeSoftware: 'core-latest'
      };

      await utils.auth.manageBitcoinConf(settings);

      // Should call software switch
      expect(utils.auth.switchBitcoinSoftware).toHaveBeenCalledWith('core-latest');

      // Should write minimal configuration
      const writtenContent = fs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('maxconnections=64');
      expect(writtenContent).not.toContain('rpcbind=0.0.0.0');
      expect(writtenContent).not.toContain('proxy=127.0.0.1:9050');
      expect(writtenContent).toContain('zmqpubhashblock=tcp://127.0.0.1:28332');
    });
  });
});
