const { join } = require('path');
const { exec, spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs').promises;
const { GraphQLError } = require('graphql');
const util = require('util');

// Convert exec to use promises
const execPromise = util.promisify(exec);

class McuService {
  constructor(knex, utils) {
    this.knex = knex;
    this.utils = utils;
  }

  // Get MCU stats
  async getStats() {
    try {
      const stats = await this._getOsStats();
      stats.timestamp = new Date().toISOString();
      return { stats };
    } catch (error) {
      throw new GraphQLError(`Failed to get MCU stats: ${error.message}`);
    }
  }

  // Scan for WiFi networks
  async scanWifi() {
    try {
      const wifiScan = await this._getWifiScan();
      return { wifiScan };
    } catch (error) {
      throw new GraphQLError(`Failed to scan WiFi networks: ${error.message}`);
    }
  }

  // Connect to WiFi network
  async connectWifi({ ssid, passphrase }) {
    try {
      await this._wifiConnect(ssid, passphrase);
      const address = await this._getIpAddress();
      return { address };
    } catch (error) {
      throw new GraphQLError(`Failed to connect to WiFi: ${error.message}`);
    }
  }

  // Disconnect from WiFi network
  async disconnectWifi() {
    try {
      await this._wifiDisconnect();
    } catch (error) {
      throw new GraphQLError(`Failed to disconnect from WiFi: ${error.message}`);
    }
  }

  /**
   * Read the system timezone and the list the device can be set to.
   *
   * Devices ship with the factory image default (America/New_York), which most
   * owners never change: it skews journal timestamps, the DB timestamps behind
   * the charts, and — since the automation reads the wall clock — the hour at
   * which a time rule fires.
   */
  async getTimezone() {
    try {
      const current = await this._spawnCommand('timedatectl', ['show', '-p', 'Timezone', '--value']);
      const available = await this._spawnCommand('timedatectl', ['list-timezones']);

      return {
        timezone: current.trim() || 'UTC',
        available: available
          .split('\n')
          .map((zone) => zone.trim())
          .filter(Boolean),
      };
    } catch (error) {
      throw new GraphQLError(`Failed to read timezone: ${error.message}`);
    }
  }

  async setTimezone({ timezone }) {
    try {
      // Validate against what the system actually knows, and pass the value as an
      // argv element — never interpolated into a shell string.
      const { available } = await this.getTimezone();
      if (!available.includes(timezone)) {
        throw new Error(`Unknown timezone: ${timezone}`);
      }

      if (process.env.NODE_ENV === 'production') {
        await this._spawnCommand('sudo', ['timedatectl', 'set-timezone', timezone]);
      } else {
        console.log(`[DEV] Would set system timezone to ${timezone}`);
      }

      return this.getTimezone();
    } catch (error) {
      throw new GraphQLError(`Failed to set timezone: ${error.message}`);
    }
  }

  // Reboot device
  async reboot() {
    try {
      if (process.env.NODE_ENV === 'production') {
        await this._execCommand('sudo reboot');
      } else {
        console.log('Reboot command would execute in production mode');
      }
    } catch (error) {
      throw new GraphQLError(`Failed to reboot device: ${error.message}`);
    }
  }

  // Shutdown device
  async shutdown() {
    try {
      if (process.env.NODE_ENV === 'production') {
        await this._execCommand('sudo shutdown -h now');
      } else {
        console.log('Shutdown command would execute in production mode');
      }
    } catch (error) {
      throw new GraphQLError(`Failed to shutdown device: ${error.message}`);
    }
  }

  // Get application version
  async getVersion() {
    try {
      // First try to get remote version
      const gitAppVersion = await axios.get(
        `https://raw.githubusercontent.com/jstefanop/apolloui-v2/${process.env.NODE_ENV === 'development' ? 'dev' : 'main'
        }/package.json`
      );

      if (gitAppVersion && gitAppVersion.data) {
        return gitAppVersion.data.version;
      }
    } catch (error) {
      console.log('Failed to get remote version, falling back to local version:', error.message);
    }

    // If remote version fails, return local version
    try {
      const localPackageJson = require('../../package.json');
      return localPackageJson.version;
    } catch (error) {
      throw new GraphQLError(`Failed to get application version: ${error.message}`);
    }
  }

  // Update firmware
  async update() {
    try {
      let scriptName = 'update';
      if (process.env.NODE_ENV === 'development') scriptName = 'update.fake';

      const updateScript = join(__dirname, '../../backend', scriptName);
      const cmd = spawn(process.env.NODE_ENV === 'development' ? 'bash' : 'sudo', 
        process.env.NODE_ENV === 'development' ? [updateScript] : ['bash', updateScript]);

      cmd.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
      });

      cmd.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
      });

      cmd.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
      });
    } catch (error) {
      throw new GraphQLError(`Failed to update firmware: ${error.message}`);
    }
  }

  // Get update progress
  async getUpdateProgress() {
    try {
      // Check if the progress file exists
      const filePath = '/tmp/update_progress';
      let fileExists = true;

      try {
        await fs.access(filePath, fs.constants.F_OK);
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist
          console.log('update_progress file not found. Returning default progress.');
          fileExists = false;
        } else {
          throw error;
        }
      }

      if (!fileExists) {
        return { value: 0 };
      }

      // Read the progress value from the file
      const data = await fs.readFile(filePath);
      const progress = parseInt(data.toString());

      return { value: progress };
    } catch (error) {
      console.log('Error getting update progress:', error);
      return { value: 0 };
    }
  }

  // Helper method to get OS stats
  async _getOsStats() {
    return new Promise((resolve, reject) => {
      const scriptName = (process.env.NODE_ENV === 'production')
        ? 'os_stats'
        : 'os_stats_fake';

      const scriptPath = join(__dirname, '../../backend', scriptName);

      exec(scriptPath, {}, (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          try {
            const result = JSON.parse(stdout.toString());
            resolve(result);
          } catch (err) {
            reject(err);
          }
        }
      });
    });
  }

  // Helper method to scan for WiFi networks
  async _getWifiScan() {
    return new Promise((resolve, reject) => {
      const scriptName = (process.env.NODE_ENV === 'production')
        ? 'wifi_scan'
        : 'wifi_scan_fake';

      const scriptPath = join(__dirname, '../../backend', scriptName);

      exec(scriptPath, {}, (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          try {
            const result = JSON.parse(stdout.toString());
            resolve(result);
          } catch (err) {
            reject(err);
          }
        }
      });
    });
  }

  // Helper method to connect to WiFi network (spawn + argv only — no shell on ssid/passphrase)
  async _wifiConnect(ssid, passphrase) {
    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd) {
      await new Promise((r) => setTimeout(r, 2000));
    }

    const nmcliArgs = ['dev', 'wifi', 'connect', ssid];
    if (passphrase) {
      nmcliArgs.push('password', passphrase);
    }

    return new Promise((resolve, reject) => {
      const child = isProd
        ? spawn('sudo', ['nmcli', ...nmcliArgs], { stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn('nmcli', nmcliArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        const out = (stdout + stderr).toString();
        if (code !== 0) {
          reject(new Error(out.trim() || `nmcli exited with code ${code}`));
          return;
        }
        if (out.includes('Error')) {
          const errMsg = out
            .trim()
            .replace(/^.+\(\d+\)\ /g, '')
            .replace(/\.$/g, '');
          reject(new Error(errMsg));
        } else {
          resolve();
        }
      });
    });
  }

  // Helper method to disconnect from WiFi network
  async _wifiDisconnect() {
    return new Promise((resolve, reject) => {
      let command = 'for i in $(nmcli -t c show|grep wlan); do nmcli c delete `echo $i|cut -d":" -f2`; done';

      if (process.env.NODE_ENV !== 'production') {
        command = 'sleep 2 && echo true';
      }

      exec(command, {}, (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          if (stdout.includes('Error')) {
            const errMsg = stdout.trim()
              .replace(/^.+\(\d+\)\ /g, "")
              .replace(/\.$/g, "");

            reject(new Error(errMsg));
          } else {
            resolve();
          }
        }
      });
    });
  }

  // Helper method to get IP address
  async _getIpAddress() {
    return new Promise((resolve, reject) => {
      let command = "ip -4 addr list wlan0 | grep inet | cut -d' ' -f6 | cut -d/ -f1";

      if (process.env.NODE_ENV !== 'production') {
        command = 'echo "127.0.0.1"';
      }

      exec(command, {}, (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          const address = stdout.trim();
          resolve(address);
        }
      });
    });
  }

  // Run a command with an argv array: no shell, so no argument can be turned into
  // one (same rule as the nmcli and chpasswd paths).
  _spawnCommand(command, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  // Helper method to execute shell commands
  async _execCommand(command) {
    try {
      const { stdout, stderr } = await execPromise(command);
      if (stderr) {
        console.error(`Command stderr: ${stderr}`);
      }
      return stdout.trim();
    } catch (error) {
      throw error;
    }
  }
}

module.exports = (knex, utils) => new McuService(knex, utils);