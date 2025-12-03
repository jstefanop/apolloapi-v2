const { exec } = require('child_process');
const { promisify } = require('util');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const net = require('net');

const execAsync = promisify(exec);

class ServiceMonitor {
  constructor(knex, services) {
    this.knex = knex;
    this.services = services || {};
    this.monitoring = false;
    this.interval = null;
    this.config = this.loadConfig();
    this.checkInterval = this.config.checkInterval || 10000; // 10 seconds default
    this.systemdServices = this.config.services || [
      'apollo-miner',
      'node',
      'ckpool',
      'apollo-api',
      'apollo-ui-v2',
    ];

    // Mapping between systemd service names and database service names
    this.serviceMapping = {
      'apollo-miner': 'miner',
      ckpool: 'solo',
      node: 'node',
      'apollo-api': 'apollo-api',
      'apollo-ui-v2': 'apollo-ui-v2',
    };
  }

  // Load configuration from JSON file
  loadConfig() {
    try {
      const configPath = path.join(
        process.cwd(),
        'config',
        'service-monitor.json'
      );
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('Service monitor configuration loaded:', config);
        return config;
      }
    } catch (error) {
      console.error('Error loading service monitor configuration:', error);
    }

    // Default configuration
    return {
      enabled: true,
      checkInterval: 10000,
      services: [
        'apollo-miner',
        'node',
        'ckpool',
        'apollo-api',
        'apollo-ui-v2',
      ],
      logLevel: 'info',
      autoStart: true,
      systemdIntegration: true,
    };
  }

  // Start monitoring
  async start() {
    if (!this.config.enabled) {
      console.log('Service monitor disabled in configuration');
      return;
    }

    if (this.monitoring) {
      console.log('Service monitor already active');
      return;
    }

    // Skip monitoring in development environment
    if (this.isDevelopment()) {
      console.log(
        'Service monitor skipped in development environment - status managed by API calls only'
      );
      return;
    }

    console.log('Starting service monitor...');
    this.monitoring = true;

    // First immediate check
    try {
      await this.checkAllServices();
    } catch (error) {
      console.error('Error during initial service check:', error);
    }

    // Then periodic checks
    this.interval = setInterval(async () => {
      try {
        await this.checkAllServices();
      } catch (error) {
        console.error('Error during periodic service check:', error);
      }
    }, this.checkInterval);

    console.log(
      `Service monitor started with interval of ${this.checkInterval}ms`
    );
  }

  // Stop monitoring
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.monitoring = false;
    console.log('Service monitor stopped');
  }

  // Get database service name from systemd service name
  getDatabaseServiceName(systemdServiceName) {
    return this.serviceMapping[systemdServiceName] || systemdServiceName;
  }

  // Check if we're in development environment
  isDevelopment() {
    return process.env.NODE_ENV === 'development';
  }

  // Check if Bitcoin node is remote (not localhost)
  async isRemoteNode() {
    const nodeHost = process.env.BITCOIN_NODE_HOST;

    // If NODE_ENV is development, always consider local
    if (this.isDevelopment()) {
      return false;
    }

    // If BITCOIN_NODE_HOST is not set or is localhost, it's local
    if (!nodeHost || nodeHost === '127.0.0.1' || nodeHost === 'localhost') {
      return false;
    }

    // If BITCOIN_NODE_HOST is set to a different IP, it's remote
    return true;
  }

  // Check network connectivity to remote node
  async checkRemoteNodeConnectivity() {
    const nodeHost = process.env.BITCOIN_NODE_HOST;
    const nodePort = process.env.BITCOIN_NODE_PORT || 8332;

    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 5000; // 5 seconds timeout

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        socket.destroy();
        resolve({ status: 'online', systemdStatus: 'connected' });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({ status: 'offline', systemdStatus: 'timeout' });
      });

      socket.on('error', () => {
        socket.destroy();
        resolve({ status: 'offline', systemdStatus: 'connection_failed' });
      });

      try {
        socket.connect(nodePort, nodeHost);
      } catch (error) {
        resolve({ status: 'offline', systemdStatus: 'connection_error' });
      }
    });
  }

  // Check status of a single service
  // This method now respects manual actions (CLI starts/stops) by detecting
  // discrepancies between actual status and requested_status, and updating
  // requested_status to reflect reality instead of fighting user actions.
  async checkServiceStatus(serviceName) {
    try {
      // Skip systemd checks in development environment
      if (this.isDevelopment()) {
        return {
          serviceName,
          status: 'unknown',
          systemdStatus: 'skipped_dev',
        };
      }

      // Get database service name
      const dbServiceName = this.getDatabaseServiceName(serviceName);

      // Special handling for Bitcoin node when it's remote
      if (serviceName === 'node' && (await this.isRemoteNode())) {
        const connectivity = await this.checkRemoteNodeConnectivity();
        await this.updateServiceStatus(
          dbServiceName,
          connectivity.status,
          null
        );
        return {
          serviceName: dbServiceName,
          status: connectivity.status,
          systemdStatus: connectivity.systemdStatus,
        };
      }

      // For miner and node, also check if they respond to API calls
      // This provides better status detection than just systemd
      let applicationOnline = null;
      if ((serviceName === 'apollo-miner' || serviceName === 'node') && this.services) {
        try {
          if (serviceName === 'apollo-miner' && this.services.miner) {
            const minerStatus = await this.services.miner.checkOnline();
            applicationOnline = minerStatus?.online?.status;
          } else if (serviceName === 'node' && this.services.node) {
            const nodeStatus = await this.services.node.checkOnline();
            applicationOnline = nodeStatus?.online?.status;
          }
        } catch (error) {
          // Continue with systemd check as fallback
        }
      }

      // Standard systemctl check for local services
      let status;
      try {
        const { stdout, stderr } = await execAsync(`systemctl is-active ${serviceName}`);
        status = stdout.trim();
      } catch (error) {
        // systemctl is-active returns different exit codes for different states
        // Exit code 0: active, Exit code 3: inactive, Exit code 4: failed
        if (error.code === 3) {
          status = 'inactive';
        } else if (error.code === 4) {
          status = 'failed';
        } else {
          // For other exit codes, try to get status from stdout if available
          status = error.stdout ? error.stdout.trim() : 'unknown';
        }
      }

      // Get current requested status from database (needed for both status mapping and auto-start)
      const existing = await this.knex('service_status')
        .where({ service_name: dbServiceName })
        .first();

      // Map systemd status to internal status
      let mappedStatus = 'unknown';
      let requestedStatus = null;

      switch (status) {
        case 'active':
          mappedStatus = 'online';
          break;
        case 'inactive':
          mappedStatus = 'offline';
          break;
        case 'activating':
          mappedStatus = 'pending';
          break;
        case 'deactivating':
          mappedStatus = 'pending';
          break;
        case 'failed':
          // Check if this service was requested to be offline (stopped from UI)
          if (existing && existing.requested_status === 'offline') {
            // If service was stopped from UI, treat failed as offline
            mappedStatus = 'offline';
          } else {
            // Otherwise, treat failed as error
            mappedStatus = 'error';
          }
          break;
        default:
          mappedStatus = 'unknown';
      }

      // Detect manual actions FIRST using systemd status (source of truth for manual actions)
      // This ensures the UI reflects reality instead of fighting user actions
      if (existing) {
        // MANUAL START: Systemd is active/activating but was requested to be offline
        // → User started it manually (CLI or other means)
        if (
          (status === 'active' || status === 'activating') &&
          existing.requested_status === 'offline'
        ) {
          console.log(
            `🔄 Service ${serviceName} (${dbServiceName}) started manually (systemd: ${status}) - updating requested_status to 'online'`
          );
          requestedStatus = 'online';
        }
        // MANUAL STOP: Systemd is inactive but was requested to be online
        // → User stopped it manually (not a crash)
        else if (
          status === 'inactive' &&
          existing.requested_status === 'online'
        ) {
          console.log(
            `🔄 Service ${serviceName} (${dbServiceName}) stopped manually (systemd: inactive) - updating requested_status to 'offline'`
          );
          requestedStatus = 'offline';
        }
        // AUTO-RESTART: Service failed but was requested to be online
        // → Auto-restart if enabled
        else if (
          status === 'failed' &&
          existing.requested_status === 'online' &&
          this.config.autoStart
        ) {
          console.log(
            `🔄 Auto-restarting failed service ${serviceName} (${dbServiceName})`
          );
          try {
            await execAsync(`sudo systemctl restart ${serviceName}`);
            console.log(`✅ Successfully restarted service ${serviceName}`);
            // Override status to pending as it's restarting
            mappedStatus = 'pending';
          } catch (restartError) {
            console.error(
              `❌ Failed to auto-restart service ${serviceName}:`,
              restartError.message
            );
            mappedStatus = 'error';
          }
        }
      }

      // Now determine final status for UI/DB
      // Priority: application status (if available and reliable), then systemd mapped status
      let finalStatus;
      
      // Special handling for services with application check (miner, node)
      if (applicationOnline) {
        // If systemd says active but app says offline/pending, service is probably starting up
        if ((status === 'active' || status === 'activating') && 
            (applicationOnline === 'offline' || applicationOnline === 'error')) {
          finalStatus = 'pending';
        }
        // If systemd says inactive/failed, trust that over app status
        else if (status === 'inactive' || status === 'failed') {
          finalStatus = mappedStatus;
        }
        // Otherwise use app status (most accurate)
        else {
          finalStatus = applicationOnline;
        }
      } else {
        // No application check, use systemd mapped status
        finalStatus = mappedStatus;
      }

      // Update database with final status
      await this.updateServiceStatus(
        dbServiceName,
        finalStatus,
        requestedStatus
      );

      return {
        serviceName: dbServiceName,
        status: finalStatus,
        systemdStatus: status,
      };
    } catch (error) {
      console.error(`Error checking service ${serviceName}:`, error.message);
      console.error(`Error stack for ${serviceName}:`, error.stack);
      // Only mark as unknown if there's a real error (not systemctl exit codes)
      const dbServiceName = this.getDatabaseServiceName(serviceName);
      await this.updateServiceStatus(dbServiceName, 'unknown', null);
      return {
        serviceName: dbServiceName,
        status: 'unknown',
        systemdStatus: 'error',
      };
    }
  }

  // Check all services
  async checkAllServices() {
    try {
      const promises = this.systemdServices.map((service) =>
        this.checkServiceStatus(service)
      );
      const results = await Promise.all(promises);

      // Always log service status summary for monitoring
      console.log('Service Status:');
      for (const result of results) {
        console.log(`  - ${result.serviceName}: ${result.status} (systemd: ${result.systemdStatus})`);
      }

      // Check for discrepancies with requested status
      const discrepancies = [];
      for (const result of results) {
        const dbRecord = await this.knex('service_status')
          .where({ service_name: result.serviceName })
          .first();
        
        if (dbRecord && dbRecord.requested_status) {
          if (dbRecord.requested_status !== result.status) {
            discrepancies.push({
              service: result.serviceName,
              requested: dbRecord.requested_status,
              actual: result.status
            });
          }
        }
      }

      if (discrepancies.length > 0) {
        console.log('⚠️  Discrepancies:');
        for (const d of discrepancies) {
          console.log(`  - ${d.service}: requested=${d.requested}, actual=${d.actual}`);
        }
      }

      return results;
    } catch (error) {
      console.error('Error checking services:', error);
      console.error('Error stack:', error.stack);
    }
  }

  // Update service status in database
  async updateServiceStatus(serviceName, status, requestedStatus = null) {
    try {
      const now = Date.now();

      // Check if record already exists for this service
      const existing = await this.knex('service_status')
        .where({ service_name: serviceName })
        .first();

      if (existing) {
        // Update only if status changed
        if (existing.status !== status) {
          // Preserve existing requested_status if not explicitly provided
          const finalRequestedStatus =
            requestedStatus !== null
              ? requestedStatus
              : existing.requested_status;
          const finalRequestedAt =
            requestedStatus !== null
              ? requestedStatus
                ? now
                : null
              : existing.requested_at;

          await this.knex('service_status')
            .where({ service_name: serviceName })
            .update({
              status: status,
              last_checked: now,
              requested_status: finalRequestedStatus,
              requested_at: finalRequestedAt,
            });

          console.log(
            `Service ${serviceName} updated: ${existing.status} -> ${status}`
          );
        } else {
          // Update only the last checked timestamp
          await this.knex('service_status')
            .where({ service_name: serviceName })
            .update({
              last_checked: now,
            });
        }
      } else {
        // Create new record
        await this.knex('service_status').insert({
          service_name: serviceName,
          status: status,
          requested_status: requestedStatus,
          requested_at: requestedStatus ? now : null,
          last_checked: now,
        });

        console.log(
          `New service ${serviceName} registered with status: ${status}`
        );
      }
    } catch (error) {
      console.error(`Error updating database for ${serviceName}:`, error);
    }
  }

  // Get current status of all services
  async getCurrentStatuses() {
    try {
      const promises = this.systemdServices.map((service) =>
        this.checkServiceStatus(service)
      );
      return await Promise.all(promises);
    } catch (error) {
      console.error('Error getting current statuses:', error);
      return [];
    }
  }

  // Force immediate check
  async forceCheck() {
    console.log('Forcing service check...');
    return await this.checkAllServices();
  }

  // Reload configuration
  reloadConfig() {
    this.config = this.loadConfig();
    this.checkInterval = this.config.checkInterval || 10000;
    this.systemdServices = this.config.services || this.systemdServices;

    if (this.monitoring && this.interval) {
      // Restart monitor with new configuration
      this.stop();
      this.start();
    }

    console.log('Service monitor configuration reloaded');
  }

  // Get remote node information for debugging
  async getRemoteNodeInfo() {
    if (this.isDevelopment()) {
      return {
        isRemote: false,
        isDevelopment: true,
        message: 'Development environment - service monitor disabled',
      };
    }

    const isRemote = await this.isRemoteNode();
    if (!isRemote) {
      return { isRemote: false, message: 'Node is local' };
    }

    return {
      isRemote: true,
      host: process.env.BITCOIN_NODE_HOST,
      port: process.env.BITCOIN_NODE_PORT || 8332,
      message: `Monitoring remote node at ${process.env.BITCOIN_NODE_HOST}:${
        process.env.BITCOIN_NODE_PORT || 8332
      }`,
    };
  }
}

module.exports = (knex, services) => new ServiceMonitor(knex, services);
