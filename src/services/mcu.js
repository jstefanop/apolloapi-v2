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

      // The update runs inline for many minutes and reports through its own
      // progress marker (-10 on failure), so its OUTCOME is not awaited here —
      // unlike the format launcher, which detaches at once. But the spawn itself
      // must be: a process that cannot even start ('error' — sudo or bash
      // missing, EACCES) used to be reported as a started update, and with no
      // 'error' listener the event would crash the whole API.
      await new Promise((resolve, reject) => {
        cmd.once('spawn', resolve);
        cmd.once('error', reject);
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
          // No marker file is the normal state — nothing is running. The UI polls
          // this continuously, so logging it unconditionally wrote thousands of
          // lines a day into a journal this release makes persistent on the eMMC,
          // rotating away the crash evidence it exists to keep.
          if (process.env.NODE_ENV === 'development') {
            console.log('update_progress file not found. Returning default progress.');
          }
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