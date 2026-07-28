const { GraphQLError } = require('graphql');
const generateConf = require('../configurator');

// Middle of the range apollo-miner-v3 accepts (5-22 TH/s); the UI seeds the same
// value when someone picks custom mode.
const DEFAULT_APOLLO_III_HASHRATE = 12;

class SettingsService {
  constructor(knex, utils) {
    this.knex = knex;
    this.utils = utils;
  }

  // Convert GraphQL enum format (core_25_1) to backend format (core-25.1)
  _enumToBackendFormat(enumValue) {
    if (!enumValue) return null;
    // If already in backend format (has dash and dot), return as is
    if (enumValue.includes('-') && enumValue.includes('.')) return enumValue;
    // If already in backend format but missing dot, check if it's valid
    if (enumValue.includes('-') && !enumValue.includes('_')) {
      // Might be old format like core-25-1, need to fix
      // This shouldn't happen, but handle it
      return enumValue;
    }
    // Convert from enum format (core_25_1) to backend format (core-25.1)
    // Pattern: core_25_1 -> core-25.1
    // Replace first underscore with dash, remaining underscores with dots
    const parts = enumValue.split('_');
    if (parts.length >= 3) {
      // Format: [core, 25, 1] -> core-25.1
      return `${parts[0]}-${parts.slice(1).join('.')}`;
    }
    // Fallback: replace all underscores with dashes (shouldn't happen)
    return enumValue.replace(/_/g, '-');
  }

  // Convert backend format (core-25.1) to GraphQL enum format (core_25_1)
  _backendToEnumFormat(backendValue) {
    if (!backendValue) return null;
    // Handle different formats that might be in the database
    // Format 1: core-25.1 (backend format) -> core_25_1
    // Format 2: core_28.1 (old format with underscore and dot) -> core_28_1
    // Format 3: core_25_1 (already enum format) -> return as is
    
    // If already in correct enum format (has underscores and no dashes), return as is
    if (backendValue.includes('_') && !backendValue.includes('-')) {
      // But need to replace dots with underscores if present
      return backendValue.replace(/\./g, '_');
    }
    
    // Convert from backend format (core-25.1) to enum format (core_25_1)
    // Replace dashes with underscores, and ensure dots are also underscores
    return backendValue.replace(/-/g, '_').replace(/\./g, '_');
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

  // Validate btcsig format
  // User provides only the customizable part (max 26 chars)
  // The final coinbase signature will be: /FutureBit-{btcsig}/
  _validateBtcsig(btcsig) {
    if (!btcsig) {
      return; // Allow empty/null values - will use default
    }

    // Check maximum length (26 characters for user part)
    // Final signature will be: /FutureBit-{btcsig}/ = 10 + 26 + 2 = 38 chars max
    if (btcsig.length > 26) {
      throw new Error('btcsig must not exceed 26 characters');
    }

    // Check for printable ASCII characters only (32-126), excluding slashes
    const isPrintableAscii = /^[\x20-\x7E]*$/.test(btcsig);
    if (!isPrintableAscii) {
      throw new Error('btcsig must contain only printable ASCII characters');
    }

    // Disallow slashes as they're used as delimiters
    if (btcsig.includes('/')) {
      throw new Error('btcsig cannot contain "/" characters');
    }
  }

  // Apollo III tuning. Validated here, on the way in, rather than clamped when the
  // command line is rendered: a value that is only clamped later is stored and
  // read back at its original figure, so the UI reports 99 TH/s while the miner
  // runs at 22 and nothing tells the user the two disagree.
  _validateApolloIiiTuning(input) {
    const ranges = {
      minerHashrate: [5, 22, 'Target hashrate must be between 5 and 22 TH/s'],
      fanTemp: [40, 80, 'Fan target temperature must be between 40 and 80 C'],
      fanPwm: [10, 100, 'Fan speed must be between 10 and 100%'],
    };

    for (const [field, [min, max, message]] of Object.entries(ranges)) {
      const value = input[field];
      // null clears the setting — that is how "not set" is expressed.
      if (value === undefined || value === null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${field} must be a number`);
      }
      if (value < min || value > max) throw new Error(message);
    }
  }

  // Validate startdiff format
  // Must be a positive integer
  _validateStartdiff(startdiff) {
    if (startdiff === undefined || startdiff === null) {
      return; // Allow undefined/null values - will use default
    }

    // Check if it's a number
    if (typeof startdiff !== 'number') {
      throw new Error('startdiff must be a number');
    }

    // Check if it's an integer
    if (!Number.isInteger(startdiff)) {
      throw new Error('startdiff must be an integer');
    }

    // Check if it's positive
    if (startdiff <= 0) {
      throw new Error('startdiff must be a positive integer');
    }
  }

  // Validate mindiff format
  // Minimum difficulty vardiff will allow miners to drop to. Must be a positive integer.
  _validateMindiff(mindiff) {
    if (mindiff === undefined || mindiff === null) {
      return; // Allow undefined/null values - will use default
    }

    if (typeof mindiff !== 'number') {
      throw new Error('mindiff must be a number');
    }

    if (!Number.isInteger(mindiff)) {
      throw new Error('mindiff must be an integer');
    }

    if (mindiff <= 0) {
      throw new Error('mindiff must be a positive integer');
    }
  }

  // Update settings
  async update(settingsInput) {
    try {
      // Handle btcsig: if null/empty, use default value
      // Default btcsig will become "/FutureBit-mined by Solo Apollo/" when composed
      const DEFAULT_BTCSIG = 'mined by Solo Apollo';
      
      if (settingsInput.btcsig !== undefined) {
        if (!settingsInput.btcsig || settingsInput.btcsig.trim() === '') {
          // Set default if null or empty
          settingsInput.btcsig = DEFAULT_BTCSIG;
        } else {
          // Validate non-empty btcsig
          this._validateBtcsig(settingsInput.btcsig);
        }
      }

      // Validate startdiff if provided
      if (settingsInput.startdiff !== undefined) {
        this._validateStartdiff(settingsInput.startdiff);
      }

      // Validate mindiff if provided
      if (settingsInput.mindiff !== undefined) {
        this._validateMindiff(settingsInput.mindiff);
      }

      this._validateApolloIiiTuning(settingsInput);

      // Custom mode needs a target hashrate to act on. Without one the generator
      // falls back to eco, so an Apollo III would run at its lowest preset while
      // Settings.read still reports "custom" — a disagreement with no way for the
      // user to notice it. Settle it here, where the value is stored, rather than
      // in the argument renderer where it stays invisible. Harmless on Apollo
      // I/II: custom there is driven by voltage and frequency, and miner_config3
      // is not the file that device reads.
      // Decided on the resulting state, not on this request alone: a partial
      // update that clears the hashrate without resending the mode would
      // otherwise leave custom with nothing to act on, which is the mismatch this
      // exists to prevent.
      const storedSettings = await this._readSettings();
      const resultingMode =
        settingsInput.minerMode !== undefined
          ? settingsInput.minerMode
          : storedSettings?.minerMode;
      const resultingHashrate =
        settingsInput.minerHashrate !== undefined
          ? settingsInput.minerHashrate
          : storedSettings?.minerHashrate;

      if (
        resultingMode === 'custom' &&
        (resultingHashrate === null || resultingHashrate === undefined)
      ) {
        settingsInput.minerHashrate = DEFAULT_APOLLO_III_HASHRATE;
      }

      // Get existing settings before update
      const oldSettings = await this._readSettings();

      // Convert nodeSoftware from GraphQL enum format to backend format if present
      const convertedInput = { ...settingsInput };
      if (convertedInput.nodeSoftware) {
        convertedInput.nodeSoftware = this._enumToBackendFormat(convertedInput.nodeSoftware);
      }

      // Check if Bitcoin software is being changed. Only when the caller actually
      // provided nodeSoftware: a partial update (e.g. the automation setting only
      // minerMode) leaves convertedInput.nodeSoftware undefined, and comparing the
      // stored 'core-31.0' against undefined read as a switch — needlessly running
      // switchBitcoinSoftware, which stops and restarts bitcoind on every mode change.
      const oldSoftwareBackend = oldSettings.nodeSoftware ? this._enumToBackendFormat(oldSettings.nodeSoftware) : null;
      const isBitcoinSoftwareChanging =
        convertedInput.nodeSoftware != null && oldSoftwareBackend !== convertedInput.nodeSoftware;

      // Update settings in database
      await this._updateSettings(convertedInput);

      // Read updated settings
      const newSettings = await this._readSettings();

      // If Bitcoin software is changing, handle it separately
      if (isBitcoinSoftwareChanging && newSettings.nodeSoftware) {
        try {
          // Convert to backend format for the switch function
          const backendFormat = this._enumToBackendFormat(newSettings.nodeSoftware);
          console.log(`Bitcoin software changing from ${oldSettings.nodeSoftware} to ${backendFormat}`);
          const switchResult = await this.utils.auth.switchBitcoinSoftware(backendFormat);
          
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
      // Convert settings to backend format for manageBitcoinConf
      const backendSettings = { ...newSettings };
      if (backendSettings.nodeSoftware) {
        backendSettings.nodeSoftware = this._enumToBackendFormat(backendSettings.nodeSoftware);
      }
      
      if (
        oldSettings.nodeEnableTor !== newSettings.nodeEnableTor ||
        oldSettings.nodeUserConf !== newSettings.nodeUserConf ||
        oldSettings.nodeEnableSoloMining !== newSettings.nodeEnableSoloMining ||
        oldSettings.nodeRpcPassword !== newSettings.nodeRpcPassword ||
        oldSettings.nodeAllowLan !== newSettings.nodeAllowLan ||
        oldSettings.nodeMaxConnections !== newSettings.nodeMaxConnections ||
        oldSettings.btcsig !== newSettings.btcsig ||
        oldSettings.startdiff !== newSettings.startdiff ||
        oldSettings.mindiff !== newSettings.mindiff ||
        (!isBitcoinSoftwareChanging && oldSettings.nodeSoftware !== newSettings.nodeSoftware)
      ) {
        await this.utils.auth.manageBitcoinConf(backendSettings);
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
        'fan',
        'fan_low',
        'fan_high',
        'miner_hashrate as minerHashrate',
        'fan_temp as fanTemp',
        'fan_pwm as fanPwm',
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
        'startdiff',
        'mindiff',
        'node_software as nodeSoftware'
      ])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1);

    // Convert nodeSoftware from backend format to GraphQL enum format
    if (settings && settings.nodeSoftware) {
      settings.nodeSoftware = this._backendToEnumFormat(settings.nodeSoftware);
    }

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
      'fan',
      'fan_low',
      'fan_high',
      'miner_hashrate as minerHashrate',
      'fan_temp as fanTemp',
      'fan_pwm as fanPwm',
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
      'startdiff',
      'mindiff',
      'node_software as nodeSoftware'
    );

    readQ.orderBy('created_at', 'desc');
    readQ.limit(10);

    if (forUpdate) {
      readQ.forUpdate();
    }

    const items = await readQ;

    // Convert nodeSoftware from backend format to GraphQL enum format for all items
    items.forEach(item => {
      if (item.nodeSoftware) {
        item.nodeSoftware = this._backendToEnumFormat(item.nodeSoftware);
      }
    });

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
      minerHashrate: 'miner_hashrate',
      fanTemp: 'fan_temp',
      fanPwm: 'fan_pwm',
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
      startdiff: 'startdiff',
      mindiff: 'mindiff',
      nodeSoftware: 'node_software'
    };

    // Get current settings directly from database (backend format)
    // Important: We read directly from DB to avoid GraphQL enum conversion
    // that happens in _readSettings(). We need to keep backend format (e.g., 'core-28.1')
    // when saving to database, not enum format (e.g., 'core_28_1')
    const [currentSettings] = await this.knex('settings')
      .select([
        'miner_mode',
        'voltage',
        'frequency',
        'fan',
        'fan_low',
        'fan_high',
        'miner_hashrate',
        'fan_temp',
        'fan_pwm',
        'api_allow',
        'custom_approval',
        'connected_wifi',
        'left_sidebar_visibility',
        'left_sidebar_extended',
        'right_sidebar_visibility',
        'temperature_unit',
        'power_led_off',
        'node_rpc_password',
        'node_enable_tor',
        'node_user_conf',
        'node_enable_solo_mining',
        'node_max_connections',
        'node_allow_lan',
        'btcsig',
        'startdiff',
        'mindiff',
        'node_software'
      ])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1);

    // Map DB fields to camelCase (without enum conversion)
    const newData = {
      minerMode: currentSettings?.miner_mode,
      voltage: currentSettings?.voltage,
      frequency: currentSettings?.frequency,
      fan: currentSettings?.fan,
      fan_low: currentSettings?.fan_low,
      fan_high: currentSettings?.fan_high,
      minerHashrate: currentSettings?.miner_hashrate,
      fanTemp: currentSettings?.fan_temp,
      fanPwm: currentSettings?.fan_pwm,
      apiAllow: currentSettings?.api_allow,
      customApproval: currentSettings?.custom_approval,
      connectedWifi: currentSettings?.connected_wifi,
      leftSidebarVisibility: currentSettings?.left_sidebar_visibility,
      leftSidebarExtended: currentSettings?.left_sidebar_extended,
      rightSidebarVisibility: currentSettings?.right_sidebar_visibility,
      temperatureUnit: currentSettings?.temperature_unit,
      powerLedOff: currentSettings?.power_led_off,
      nodeRpcPassword: currentSettings?.node_rpc_password,
      nodeEnableTor: currentSettings?.node_enable_tor,
      nodeUserConf: currentSettings?.node_user_conf,
      nodeEnableSoloMining: currentSettings?.node_enable_solo_mining,
      nodeMaxConnections: currentSettings?.node_max_connections,
      nodeAllowLan: currentSettings?.node_allow_lan,
      btcsig: currentSettings?.btcsig,
      startdiff: currentSettings?.startdiff,
      mindiff: currentSettings?.mindiff,
      nodeSoftware: currentSettings?.node_software // Keep backend format!
    };

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