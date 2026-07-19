const { GraphQLError } = require('graphql');
const { execFile } = require('child_process');
const util = require('util');
const generateConf = require('../configurator');
const { applyNodeConfiguration } = require('../node/configManager');

const execFilePromise = util.promisify(execFile);

class SettingsService {
  constructor(knex, utils) {
    this.knex = knex;
    this.utils = utils;
    this.updateQueue = Promise.resolve();
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
  update(settingsInput) {
    const operation = this.updateQueue.then(() =>
      this._update({ ...settingsInput })
    );
    this.updateQueue = operation.catch(() => {});
    return operation;
  }

  async _update(settingsInput) {
    let insertedSettingsId = null;
    let oldSettings = null;
    let newSettings = null;
    let nodeConfigChanged = false;
    let ckpoolConfigChanged = false;
    let nodeConfigRequested = false;
    let ckpoolConfigRequested = false;
    let nodeLifecycleRequired = false;
    let ckpoolLifecycleRequired = false;

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

      // Get existing settings before update
      oldSettings = await this._readSettings();

      // Convert nodeSoftware from GraphQL enum format to backend format if present
      const convertedInput = { ...settingsInput };
      if (convertedInput.nodeSoftware) {
        convertedInput.nodeSoftware = this._enumToBackendFormat(convertedInput.nodeSoftware);
      }
      nodeConfigRequested = [
        'nodeEnableTor',
        'nodeUserConf',
        'nodeAllowLan',
        'nodeMaxConnections',
        'nodeSoftware',
        'nodeEnableSoloMining',
      ].some((field) => Object.hasOwn(convertedInput, field));
      ckpoolConfigRequested = [
        'nodeEnableSoloMining',
        'btcsig',
        'startdiff',
        'mindiff',
      ].some((field) => Object.hasOwn(convertedInput, field));

      // Update settings in database
      insertedSettingsId = await this._updateSettings(convertedInput);

      // Read updated settings
      newSettings = await this._readSettings();
      const backendSettings = { ...newSettings };
      if (backendSettings.nodeSoftware) {
        backendSettings.nodeSoftware = this._enumToBackendFormat(backendSettings.nodeSoftware);
      }

      nodeConfigChanged = [
        'nodeEnableTor',
        'nodeUserConf',
        'nodeAllowLan',
        'nodeMaxConnections',
        'nodeSoftware',
        'nodeEnableSoloMining',
      ].some((field) => oldSettings[field] !== newSettings[field]);
      ckpoolConfigChanged = [
        'nodeEnableSoloMining',
        'btcsig',
        'startdiff',
        'mindiff',
      ].some((field) => oldSettings[field] !== newSettings[field]);

      // Reconcile files on every write. This also repairs an interrupted prior
      // application when the submitted database values are unchanged.
      const configuration = await applyNodeConfiguration({
        knex: this.knex,
        settings: backendSettings,
      });
      const bitcoinConfigChanged = configuration.changed.some(
        (filePath) => filePath !== configuration.paths.ckpool
      );
      const ckpoolFileChanged = configuration.changed.includes(
        configuration.paths.ckpool
      );
      nodeLifecycleRequired =
        nodeConfigRequested || nodeConfigChanged || bitcoinConfigChanged;
      ckpoolLifecycleRequired =
        ckpoolConfigRequested || ckpoolConfigChanged || ckpoolFileChanged;
      if (nodeLifecycleRequired || ckpoolLifecycleRequired) {
        await this._applyServiceLifecycle(
          oldSettings,
          newSettings,
          nodeLifecycleRequired,
          ckpoolLifecycleRequired
        );
      }

      // Generate miner configuration
      await generateConf(null, newSettings);

      return newSettings;
    } catch (error) {
      if (insertedSettingsId && oldSettings) {
        try {
          await this._rollbackFailedUpdate({
            insertedSettingsId,
            oldSettings,
            newSettings,
            nodeLifecycleRequired,
            ckpoolLifecycleRequired,
          });
        } catch (rollbackError) {
          console.error(
            `[settings] Failed to roll back settings application: ${rollbackError.message}`
          );
        }
      }
      throw new GraphQLError(`Failed to update settings: ${error.message}`);
    }
  }

  async _rollbackFailedUpdate({
    insertedSettingsId,
    oldSettings,
    newSettings,
    nodeLifecycleRequired,
    ckpoolLifecycleRequired,
  }) {
    await this.knex('settings').where({ id: insertedSettingsId }).delete();

    const backendSettings = { ...oldSettings };
    if (backendSettings.nodeSoftware) {
      backendSettings.nodeSoftware = this._enumToBackendFormat(
        backendSettings.nodeSoftware
      );
    }
    await applyNodeConfiguration({
      knex: this.knex,
      settings: backendSettings,
    });

    if (newSettings) {
      await this._applyServiceLifecycle(
        newSettings,
        oldSettings,
        nodeLifecycleRequired,
        ckpoolLifecycleRequired
      );
    }
    await generateConf(null, oldSettings);
  }

  async _runSystemctl(...args) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[settings] Skipping systemctl ${args.join(' ')} outside production`);
      return;
    }
    await execFilePromise('sudo', ['systemctl', ...args]);
  }

  async _isServiceActive(service) {
    if (process.env.NODE_ENV !== 'production') return false;
    try {
      await execFilePromise('systemctl', ['is-active', '--quiet', service]);
      return true;
    } catch (_) {
      return false;
    }
  }

  async _applyServiceLifecycle(
    oldSettings,
    newSettings,
    nodeConfigChanged,
    ckpoolConfigChanged
  ) {
    const torChanged =
      oldSettings.nodeEnableTor !== newSettings.nodeEnableTor;
    if (torChanged) {
      if (newSettings.nodeEnableTor) {
        await this._runSystemctl('enable', '--now', 'tor.service');
      } else {
        await this._runSystemctl('disable', '--now', 'tor.service');
      }
    }

    let nodeIsActive = await this._isServiceActive('node.service');
    let nodeRestarted = false;
    if (nodeConfigChanged && nodeIsActive) {
      await this._runSystemctl('restart', 'node.service');
      nodeRestarted = true;
      nodeIsActive = true;
    }

    const soloChanged =
      oldSettings.nodeEnableSoloMining !==
      newSettings.nodeEnableSoloMining;
    if (soloChanged) {
      await this._setSoloRequestedStatus(
        newSettings.nodeEnableSoloMining ? 'online' : 'offline'
      );
      if (newSettings.nodeEnableSoloMining && nodeIsActive) {
        await this._runSystemctl('start', 'ckpool.service');
      } else if (!newSettings.nodeEnableSoloMining) {
        await this._runSystemctl('stop', 'ckpool.service');
      }
    } else if (
      ckpoolConfigChanged &&
      newSettings.nodeEnableSoloMining &&
      !nodeRestarted &&
      (await this._isServiceActive('ckpool.service'))
    ) {
      await this._runSystemctl('restart', 'ckpool.service');
    }
  }

  async _setSoloRequestedStatus(requestedStatus) {
    const update = {
      status: 'pending',
      requested_status: requestedStatus,
      requested_at: new Date(),
    };
    const updated = await this.knex('service_status')
      .where({ service_name: 'solo' })
      .update(update);
    if (!updated) {
      await this.knex('service_status').insert({
        service_name: 'solo',
        ...update,
      });
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
        'api_allow as apiAllow',
        'custom_approval as customApproval',
        'connected_wifi as connectedWifi',
        'left_sidebar_visibility as leftSidebarVisibility',
        'left_sidebar_extended as leftSidebarExtended',
        'right_sidebar_visibility as rightSidebarVisibility',
        'temperature_unit as temperatureUnit',
        'power_led_off as powerLedOff',
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
      'api_allow as apiAllow',
      'custom_approval as customApproval',
      'connected_wifi as connectedWifi',
      'left_sidebar_visibility as leftSidebarVisibility',
      'left_sidebar_extended as leftSidebarExtended',
      'right_sidebar_visibility as rightSidebarVisibility',
      'temperature_unit as temperatureUnit',
      'power_led_off as powerLedOff',
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
      apiAllow: 'api_allow',
      customApproval: 'custom_approval',
      connectedWifi: 'connected_wifi',
      leftSidebarVisibility: 'left_sidebar_visibility',
      leftSidebarExtended: 'left_sidebar_extended',
      rightSidebarVisibility: 'right_sidebar_visibility',
      temperatureUnit: 'temperature_unit',
      powerLedOff: 'power_led_off',
      legacyNodeRpcPassword: 'node_rpc_password',
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
      apiAllow: currentSettings?.api_allow,
      customApproval: currentSettings?.custom_approval,
      connectedWifi: currentSettings?.connected_wifi,
      leftSidebarVisibility: currentSettings?.left_sidebar_visibility,
      leftSidebarExtended: currentSettings?.left_sidebar_extended,
      rightSidebarVisibility: currentSettings?.right_sidebar_visibility,
      temperatureUnit: currentSettings?.temperature_unit,
      powerLedOff: currentSettings?.power_led_off,
      legacyNodeRpcPassword: currentSettings?.node_rpc_password,
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

    return this.knex.transaction(async (trx) => {
      await trx('settings').insert(insertData);
      const insertedSettings = await trx('settings')
        .select('id')
        .orderBy('id', 'desc')
        .first();
      const insertedSettingsId = insertedSettings.id;

      // Delete old records keeping only last 100.
      const last100 = trx('settings')
        .select('id')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(100);

      await trx('settings').whereNotIn('id', last100).delete();
      return insertedSettingsId;
    });
  }
}

module.exports = (knex, utils) => new SettingsService(knex, utils);