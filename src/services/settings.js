const { GraphQLError } = require('graphql');
const generateConf = require('../configurator');

class SettingsService {
  constructor(knex, utils) {
    this.knex = knex;
    this.utils = utils;
  }

  // List all settings
  async list() {
    try {
      const settings = await this._getSettingsCollection({});
      return { settings };
    } catch (error) {
      throw new GraphQLError(`Failed to list settings: ${error.message}`);
    }
  }

  // Read current settings
  async read() {
    try {
      const settings = await this._readSettings();
      return settings;
    } catch (error) {
      throw new GraphQLError(`Failed to read settings: ${error.message}`);
    }
  }

  // Update settings
  async update(settingsInput) {
    try {
      // Get existing settings before update
      const oldSettings = await this._readSettings();

      // Check if Bitcoin software is being changed
      const isBitcoinSoftwareChanging = oldSettings.nodeSoftware !== settingsInput.nodeSoftware;

      // Update settings in database
      await this._updateSettings(settingsInput);

      // Read updated settings
      const newSettings = await this._readSettings();

      // If Bitcoin software is changing, handle it separately
      if (isBitcoinSoftwareChanging && newSettings.nodeSoftware) {
        try {
          console.log(`Bitcoin software changing from ${oldSettings.nodeSoftware} to ${newSettings.nodeSoftware}`);
          const switchResult = await this.utils.auth.switchBitcoinSoftware(newSettings.nodeSoftware);
          
          if (!switchResult.success) {
            console.log('Warning: Bitcoin software switch failed:', switchResult.message);
            // Continue with normal configuration management
          }
        } catch (switchErr) {
          console.log('Error during Bitcoin software switch:', switchErr.message);
          // Continue with normal configuration management
        }
      }

      // If specific settings have changed, manage Bitcoin configuration
      if (
        oldSettings.nodeEnableTor !== newSettings.nodeEnableTor ||
        oldSettings.nodeUserConf !== newSettings.nodeUserConf ||
        oldSettings.nodeEnableSoloMining !== newSettings.nodeEnableSoloMining ||
        oldSettings.nodeRpcPassword !== newSettings.nodeRpcPassword ||
        oldSettings.nodeAllowLan !== newSettings.nodeAllowLan ||
        oldSettings.nodeMaxConnections !== newSettings.nodeMaxConnections ||
        oldSettings.btcsig !== newSettings.btcsig ||
        (!isBitcoinSoftwareChanging && oldSettings.nodeSoftware !== newSettings.nodeSoftware)
      ) {
        await this.utils.auth.manageBitcoinConf(newSettings);
      }

      // Generate miner configuration
      await generateConf(null, newSettings);

      return newSettings;
    } catch (error) {
      throw new GraphQLError(`Failed to update settings: ${error.message}`);
    }
  }

  // Helper method to read current settings
  async _readSettings() {
    const [settings] = await this.knex('settings')
      .select([
        'id',
        'created_at as createdAt',
        'miner_mode as minerMode',
        'voltage',
        'frequency',
        'fan_low',
        'fan_high',
        'api_allow as apiAllow',
        'custom_approval as customApproval',
        'connected_wifi as connectedWifi',
        'left_sidebar_visibility as leftSidebarVisibility',
        'left_sidebar_extended as leftSidebarExtended',
        'right_sidebar_visibility as rightSidebarVisibility',
        'temperature_unit as temperatureUnit',
        'power_led_off as powerLedOff',
        'node_rpc_password as nodeRpcPassword',
        'node_enable_tor as nodeEnableTor',
        'node_user_conf as nodeUserConf',
        'node_enable_solo_mining as nodeEnableSoloMining',
        'node_max_connections as nodeMaxConnections',
        'node_allow_lan as nodeAllowLan',
        'btcsig',
        'node_software as nodeSoftware'
      ])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1);

    return settings;
  }

  // Helper method to get settings collection
  async _getSettingsCollection({ where = {}, one, forUpdate }) {
    const readQ = this.knex('settings');

    if (where.id) {
      readQ.where('id', where.id);
    }

    readQ.select(
      'id',
      'created_at as createdAt',
      'miner_mode as minerMode',
      'voltage',
      'frequency',
      'fan_low',
      'fan_high',
      'api_allow as apiAllow',
      'custom_approval as customApproval',
      'connected_wifi as connectedWifi',
      'left_sidebar_visibility as leftSidebarVisibility',
      'left_sidebar_extended as leftSidebarExtended',
      'right_sidebar_visibility as rightSidebarVisibility',
      'temperature_unit as temperatureUnit',
      'power_led_off as powerLedOff',
      'node_rpc_password as nodeRpcPassword',
      'node_enable_tor as nodeEnableTor',
      'node_user_conf as nodeUserConf',
      'node_enable_solo_mining as nodeEnableSoloMining',
      'node_max_connections as nodeMaxConnections',
      'node_allow_lan as nodeAllowLan',
      'btcsig',
      'node_software as nodeSoftware'
    );

    readQ.orderBy('created_at', 'desc');
    readQ.limit(10);

    if (forUpdate) {
      readQ.forUpdate();
    }

    const items = await readQ;

    if (one) {
      return items[0] || null;
    }

    return items;
  }

  // Helper method to update settings
  async _updateSettings(update = {}) {
    // Define mapping for DB field names
    const updateFields = {
      minerMode: 'miner_mode',
      voltage: 'voltage',
      frequency: 'frequency',
      fan: 'fan',
      fan_low: 'fan_low',
      fan_high: 'fan_high',
      apiAllow: 'api_allow',
      customApproval: 'custom_approval',
      connectedWifi: 'connected_wifi',
      leftSidebarVisibility: 'left_sidebar_visibility',
      leftSidebarExtended: 'left_sidebar_extended',
      rightSidebarVisibility: 'right_sidebar_visibility',
      temperatureUnit: 'temperature_unit',
      powerLedOff: 'power_led_off',
      nodeRpcPassword: 'node_rpc_password',
      nodeEnableTor: 'node_enable_tor',
      nodeUserConf: 'node_user_conf',
      nodeEnableSoloMining: 'node_enable_solo_mining',
      nodeMaxConnections: 'node_max_connections',
      nodeAllowLan: 'node_allow_lan',
      btcsig: 'btcsig',
      nodeSoftware: 'node_software'
    };

    // Get current settings
    const newData = await this._readSettings();

    // Update with new values
    Object.keys(update).forEach(key => newData[key] = update[key]);

    // Prepare data for insertion
    const insertData = {};
    Object.keys(newData).forEach(key => {
      if (key !== 'agree' && key !== 'id' && key !== 'createdAt') {
        insertData[updateFields[key]] = newData[key];
      }
    });

    // Insert as new record
    await this.knex('settings').insert(insertData);

    // Delete old records keeping only last 100
    const last100 = this.knex('settings')
      .select('id')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(100);

    await this.knex('settings')
      .whereNotIn('id', last100)
      .delete();
  }
}

module.exports = (knex, utils) => new SettingsService(knex, utils);