// tests/settings.test.js
const { knex } = require('../src/db');
const settingsResolver = require('../src/graphql/resolvers/settings');

describe('Settings API', () => {
  beforeEach(async () => {
    // Reset settings to default values before each test
    await knex('settings').del();
    await knex('settings').insert({
      miner_mode: 'balanced',
      voltage: 12.0,
      frequency: 650,
      fan_low: 40,
      fan_high: 60,
      temperature_unit: 'c',
      left_sidebar_visibility: true,
      left_sidebar_extended: true,
      right_sidebar_visibility: true,
      created_at: new Date()
    });
  });

  describe('Settings.list resolver', () => {
    it('should list all settings records', async () => {
      // Add multiple settings records
      await knex('settings').insert([
        {
          miner_mode: 'eco',
          voltage: 11.8,
          frequency: 600,
          created_at: new Date(Date.now() - 86400000) // 1 day ago
        },
        {
          miner_mode: 'turbo',
          voltage: 12.4,
          frequency: 750,
          created_at: new Date(Date.now() - 172800000) // 2 days ago
        }
      ]);

      // Mock settings service
      const mockSettingsService = {
        list: jest.fn().mockResolvedValue({
          settings: [
            {
              minerMode: 'balanced',
              voltage: 12.0,
              frequency: 650,
              createdAt: new Date().toISOString()
            },
            {
              minerMode: 'eco',
              voltage: 11.8,
              frequency: 600,
              createdAt: new Date(Date.now() - 86400000).toISOString()
            },
            {
              minerMode: 'turbo',
              voltage: 12.4,
              frequency: 750,
              createdAt: new Date(Date.now() - 172800000).toISOString()
            }
          ]
        })
      };

      // Test resolver directly
      const result = await settingsResolver.SettingsActions.list(
        null,
        {},
        { services: { settings: mockSettingsService } }
      );

      expect(result.result.settings.length).toBe(3);

      // Verify order (newest first)
      expect(result.result.settings[0].minerMode).toBe('balanced');
      expect(result.result.settings[1].minerMode).toBe('eco');
      expect(result.result.settings[2].minerMode).toBe('turbo');

      expect(result.error).toBeNull();
    });

    it('should handle errors when listing settings', async () => {
      // Mock settings service with error
      const mockSettingsService = {
        list: jest.fn().mockRejectedValue(new Error('Failed to retrieve settings'))
      };

      // Test resolver directly
      const result = await settingsResolver.SettingsActions.list(
        null,
        {},
        { services: { settings: mockSettingsService } }
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error.message).toBe('Failed to retrieve settings');
    });
  });

  describe('Settings.read resolver', () => {
    it('should read current settings', async () => {
      // Mock settings service
      const mockSettingsService = {
        read: jest.fn().mockResolvedValue({
          minerMode: 'balanced',
          voltage: 12.0,
          frequency: 650,
          fan_low: 40,
          fan_high: 60,
          temperatureUnit: 'c',
          leftSidebarVisibility: true,
          leftSidebarExtended: true,
          rightSidebarVisibility: true
        })
      };

      // Test resolver directly
      const result = await settingsResolver.SettingsActions.read(
        null,
        {},
        { services: { settings: mockSettingsService } }
      );

      expect(result.result.settings).toMatchObject({
        minerMode: 'balanced',
        voltage: 12.0,
        frequency: 650,
        fan_low: 40,
        fan_high: 60,
        temperatureUnit: 'c',
        leftSidebarVisibility: true,
        leftSidebarExtended: true,
        rightSidebarVisibility: true
      });
      expect(result.error).toBeNull();
    });

    it('should handle errors when reading settings', async () => {
      // Mock settings service with error
      const mockSettingsService = {
        read: jest.fn().mockRejectedValue(new Error('Failed to read settings'))
      };

      // Test resolver directly
      const result = await settingsResolver.SettingsActions.read(
        null,
        {},
        { services: { settings: mockSettingsService } }
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error.message).toBe('Failed to read settings');
    });
  });

  describe('Settings.update resolver', () => {
    it('should update settings', async () => {
      // Mock settings service
      const mockSettingsInput = {
        minerMode: 'turbo',
        voltage: 12.2,
        frequency: 700,
        fan_low: 45,
        fan_high: 65,
        temperatureUnit: 'f'
      };

      const mockUpdatedSettings = {
        ...mockSettingsInput
      };

      const mockSettingsService = {
        update: jest.fn().mockResolvedValue(mockUpdatedSettings)
      };

      // Test resolver directly
      const result = await settingsResolver.SettingsActions.update(
        null,
        { input: mockSettingsInput },
        { services: { settings: mockSettingsService } }
      );

      expect(result.result.settings).toMatchObject(mockUpdatedSettings);
      expect(result.error).toBeNull();
      expect(mockSettingsService.update).toHaveBeenCalledWith(mockSettingsInput);
    });

    it('should handle errors when updating settings', async () => {
      // Mock settings service with error
      const mockSettingsInput = {
        minerMode: 'custom',
        voltage: 12.5
      };

      const mockSettingsService = {
        update: jest.fn().mockRejectedValue(new Error('Invalid settings configuration'))
      };

      // Test resolver directly
      const result = await settingsResolver.SettingsActions.update(
        null,
        { input: mockSettingsInput },
        { services: { settings: mockSettingsService } }
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error.message).toBe('Invalid settings configuration');
    });
  });
});