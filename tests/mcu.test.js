// tests/mcu.test.js
const { knex } = require('../src/db');
const mcuResolver = require('../src/graphql/resolvers/mcu');

describe('MCU API', () => {
  describe('Mcu.stats resolver', () => {
    it('should return MCU statistics', async () => {
      // Mock MCU service
      const mockMcuService = {
        getStats: jest.fn().mockResolvedValue({
          stats: {
            hostname: 'apollo',
            operatingSystem: 'Armbian 22.04',
            uptime: '5 days, 2:30',
            loadAverage: '0.52 0.24 0.15',
            architecture: 'arm64',
            temperature: 55,
            minerTemperature: 65.5,
            minerFanSpeed: 4000,
            activeWifi: 'MyNetwork',
            network: [
              { name: 'eth0', address: '192.168.1.100', mac: '00:11:22:33:44:55' },
              { name: 'wlan0', address: '192.168.1.101', mac: '66:77:88:99:AA:BB' }
            ],
            memory: {
              total: 8192,
              available: 4096,
              used: 4096,
              cache: 1024,
              swap: 2048
            },
            cpu: {
              threads: 4,
              usedPercent: 25.5
            },
            disks: [
              { total: 32768, used: 16384, mountPoint: '/' },
              { total: 131072, used: 65536, mountPoint: '/media/nvme' }
            ],
            timestamp: new Date().toISOString()
          }
        })
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.stats(
        null,
        {},
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.result.stats).toBeTruthy();
      expect(result.result.stats.hostname).toBe('apollo');
      expect(result.result.stats.operatingSystem).toBe('Armbian 22.04');
      expect(result.result.stats.temperature).toBe(55);
      expect(result.result.stats.minerTemperature).toBe(65.5);
      expect(result.result.stats.network.length).toBe(2);
      expect(result.result.stats.network[0].name).toBe('eth0');
      expect(result.result.stats.memory.total).toBe(8192);
      expect(result.result.stats.cpu.threads).toBe(4);
      expect(result.result.stats.disks.length).toBe(2);

      expect(result.error).toBeNull();
    });
  });

  describe('Mcu.wifiScan resolver', () => {
    it('should scan WiFi networks', async () => {
      // Mock MCU service
      const mockMcuService = {
        scanWifi: jest.fn().mockResolvedValue({
          wifiScan: [
            { ssid: 'MyNetwork', mode: 'Infra', channel: 1, rate: 130, signal: 70, security: 'WPA2', inuse: true },
            { ssid: 'Neighbor', mode: 'Infra', channel: 6, rate: 65, signal: 50, security: 'WPA2', inuse: false },
            { ssid: 'OpenWifi', mode: 'Infra', channel: 11, rate: 54, signal: 40, security: 'Open', inuse: false }
          ]
        })
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.wifiScan(
        null,
        {},
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.result.wifiScan).toBeTruthy();
      expect(result.result.wifiScan.length).toBe(3);
      expect(result.result.wifiScan[0].ssid).toBe('MyNetwork');
      expect(result.result.wifiScan[0].inuse).toBe(true);
      expect(result.result.wifiScan[1].ssid).toBe('Neighbor');
      expect(result.result.wifiScan[2].ssid).toBe('OpenWifi');
      expect(result.result.wifiScan[2].security).toBe('Open');

      expect(result.error).toBeNull();
    });
  });

  describe('Mcu.wifiConnect resolver', () => {
    it('should connect to a WiFi network', async () => {
      // Mock MCU service
      const mockMcuService = {
        connectWifi: jest.fn().mockResolvedValue({
          address: '192.168.1.101'
        })
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.wifiConnect(
        null,
        { input: { ssid: 'MyNetwork', passphrase: 'password123' } },
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.result.address).toBe('192.168.1.101');
      expect(result.error).toBeNull();
      expect(mockMcuService.connectWifi).toHaveBeenCalledWith({
        ssid: 'MyNetwork',
        passphrase: 'password123'
      });
    });

    it('should handle connection errors', async () => {
      // Mock MCU service with error
      const mockMcuService = {
        connectWifi: jest.fn().mockRejectedValue(
          new Error('Connection activation failed (5) Connection timed out')
        )
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.wifiConnect(
        null,
        { input: { ssid: 'NonExistentNetwork', passphrase: 'wrongpassword' } },
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error.message).toContain('Connection activation failed');
    });
  });

  describe('Mcu.wifiDisconnect resolver', () => {
    it('should disconnect from WiFi', async () => {
      // Mock MCU service
      const mockMcuService = {
        disconnectWifi: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.wifiDisconnect(
        null,
        {},
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.error).toBeNull();
      expect(mockMcuService.disconnectWifi).toHaveBeenCalled();
    });
  });

  describe('Mcu.reboot resolver', () => {
    it('should request system reboot', async () => {
      // Mock MCU service
      const mockMcuService = {
        reboot: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.reboot(
        null,
        {},
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.error).toBeNull();
      expect(mockMcuService.reboot).toHaveBeenCalled();
    });
  });

  describe('Mcu.shutdown resolver', () => {
    it('should request system shutdown', async () => {
      // Mock MCU service
      const mockMcuService = {
        shutdown: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.shutdown(
        null,
        {},
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.error).toBeNull();
      expect(mockMcuService.shutdown).toHaveBeenCalled();
    });
  });

  describe('Mcu.version resolver', () => {
    it('should return application version', async () => {
      // Mock MCU service
      const mockMcuService = {
        getVersion: jest.fn().mockResolvedValue('2.1.0')
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.version(
        null,
        {},
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.result).toBe('2.1.0');
      expect(result.error).toBeNull();
    });

    it('should handle version fetch errors', async () => {
      // Mock MCU service with error
      const mockMcuService = {
        getVersion: jest.fn().mockRejectedValue(new Error('Failed to fetch version'))
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.version(
        null,
        {},
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error.message).toContain('Failed to fetch version');
    });
  });

  describe('Mcu.update resolver', () => {
    it('should trigger firmware update', async () => {
      // Mock MCU service
      const mockMcuService = {
        update: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.update(
        null,
        {},
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.error).toBeNull();
      expect(mockMcuService.update).toHaveBeenCalled();
    });
  });

  describe('Mcu.updateProgress resolver', () => {
    it('should return update progress when file exists', async () => {
      // Mock MCU service
      const mockMcuService = {
        getUpdateProgress: jest.fn().mockResolvedValue({ value: 75 })
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.updateProgress(
        null,
        {},
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.result.value).toBe(75);
      expect(result.error).toBeNull();
    });

    it('should return 0 when progress file does not exist', async () => {
      // Mock MCU service with 0 progress
      const mockMcuService = {
        getUpdateProgress: jest.fn().mockResolvedValue({ value: 0 })
      };

      // Test resolver directly
      const result = await mcuResolver.McuActions.updateProgress(
        null,
        {},
        { services: { mcu: mockMcuService }, isAuthenticated: true }
      );

      expect(result.result.value).toBe(0);
      expect(result.error).toBeNull();
    });
  });
});