const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const _ = require('lodash');
const moment = require('moment');
const { GraphQLError } = require('graphql');

// Import the dev miner service for development mode
const devMinerService =
  process.env.NODE_ENV === 'development' ? require('../devMinerService') : null;

class MinerService {
  constructor(knex, utils) {
    this.knex = knex;
    this.utils = utils;
  }

  // Start the miner
  // Push the current services status to all WS subscribers immediately.
  // Uses a lazy require to avoid circular dependency (scheduler → services → miner).
  _notifyServicesStatus() {
    try {
      const { pushServicesStatus } = require('../app/scheduler');
      pushServicesStatus().catch(() => {});
    } catch (_) {}
  }

  /**
   * A manual start/stop pauses the automation rather than fighting it: a miner
   * that undoes the user's click a minute later is the fastest way to get the
   * feature switched off for good. Commands coming *from* the automation
   * obviously must not pause it.
   *
   * Lazy require: services/index builds the automation service with this one as a
   * dependency, so requiring it at module load would close the loop.
   */
  async _pauseAutomation(source) {
    if (source !== 'user') return;
    try {
      const { automation } = require('./index');
      const config = await automation.getConfig();
      if (config.enabled) await automation.setOverride({ reason: 'manual' });
    } catch (error) {
      // Never let this block a miner command (e.g. a device that has not run the
      // automation migration yet).
      console.log('Could not pause automation:', error.message);
    }
  }

  // Re-evaluate + push the automation state after a *user* start/stop so the
  // automation page reflects the new miner status immediately instead of at the
  // next 60s tick. Only for user actions — the automation's own commands would
  // otherwise recurse.
  _reevaluateAutomation(source) {
    if (source !== 'user') return;
    try {
      const { evaluateAutomation } = require('../app/scheduler');
      Promise.resolve(evaluateAutomation()).catch(() => {});
    } catch (e) {
      /* scheduler not running */
    }
  }

  async start({ source = 'user' } = {}) {
    try {
      // Update service status in the database
      await this.knex('service_status')
        .where({ service_name: 'miner' })
        .update({
          status: 'pending',
          requested_status: 'online',
          requested_at: new Date(),
        });

      // Notify subscribers immediately so the UI shows "pending" without waiting
      // for the next periodic push (up to 10s later).
      this._notifyServicesStatus();
      await this._pauseAutomation(source);

      // Start the miner based on environment
      if (process.env.NODE_ENV === 'development') {
        console.log('Starting dev miner...');
        await devMinerService.startDevMiner();
        
        // In development, update status to online after devMiner starts
        // (ServiceMonitor is disabled in dev)
        await this.knex('service_status')
          .where({ service_name: 'miner' })
          .update({
            status: 'online',
            last_checked: new Date(),
          });
        console.log('Dev miner started - status updated to online');
      } else {
        await this._execCommand('sudo systemctl start apollo-miner');
      }
      this._reevaluateAutomation(source);
    } catch (error) {
      throw new GraphQLError(`Failed to start miner: ${error.message}`);
    }
  }

  // Stop the miner
  async stop({ source = 'user' } = {}) {
    try {
      // Update service status in the database
      await this.knex('service_status')
        .where({ service_name: 'miner' })
        .update({
          status: 'pending',
          requested_status: 'offline',
          requested_at: new Date(),
        });

      this._notifyServicesStatus();
      await this._pauseAutomation(source);

      // Stop the miner based on environment
      if (process.env.NODE_ENV === 'development') {
        console.log('Stopping dev miner...');
        await devMinerService.stopDevMiner();
        
        // In development, update status to offline after devMiner stops
        // (ServiceMonitor is disabled in dev)
        await this.knex('service_status')
          .where({ service_name: 'miner' })
          .update({
            status: 'offline',
            last_checked: new Date(),
          });
        console.log('Dev miner stopped - status updated to offline');
      } else {
        await this._execCommand('sudo systemctl stop apollo-miner');
      }
      this._reevaluateAutomation(source);
    } catch (error) {
      throw new GraphQLError(`Failed to stop miner: ${error.message}`);
    }
  }

  // Restart the miner
  async restart({ source = 'user' } = {}) {
    try {
      // Update service status in the database
      await this.knex('service_status')
        .where({ service_name: 'miner' })
        .update({
          status: 'pending',
          requested_status: 'online',
          requested_at: new Date(),
        });

      this._notifyServicesStatus();
      await this._pauseAutomation(source);

      // Restart the miner based on environment
      if (process.env.NODE_ENV === 'development') {
        console.log('Restarting dev miner...');
        await devMinerService.restartDevMiner();
        
        // In development, update status to online after devMiner restarts
        // (ServiceMonitor is disabled in dev)
        await this.knex('service_status')
          .where({ service_name: 'miner' })
          .update({
            status: 'online',
            last_checked: new Date(),
          });
        console.log('Dev miner restarted - status updated to online');
      } else {
        await this._execCommand('sudo systemctl restart apollo-miner');
      }
      this._reevaluateAutomation(source);
    } catch (error) {
      throw new GraphQLError(`Failed to restart miner: ${error.message}`);
    }
  }

  // Get miner statistics
  async getStats() {
    try {
      // Fetch settings and pools
      const settingsService = require('./settings')(this.knex, this.utils);
      const poolsService = require('./pools')(this.knex, this.utils);

      const settings = await settingsService.read();
      const pools = await poolsService.list();

      // Get miner stats
      let stats = [];
      let ckpool = null;

      try {
        stats = await this._getMinerStats(settings, pools.pools);
      } catch (statsError) {
        console.error('Error getting miner stats:', statsError);
        // Continue with empty stats array instead of failing completely
      }

      try {
        ckpool = await this._getCkpoolStats(settings, pools.pools);
      } catch (ckpoolError) {
        console.error('Error getting ckpool stats:', ckpoolError);
        // Continue with null ckpool data instead of failing completely
      }

      return { stats, ckpool };
    } catch (error) {
      console.error('Error in getStats:', error);
      // Return empty data instead of throwing error
      return { stats: [], ckpool: null };
    }
  }

  // Check if miner is online
  async checkOnline() {
    try {
      // Initialize default values
      const initialUserStatus = {
        requestedStatus: null,
        requestedAt: null,
      };

      // Fetch requested status from database
      let dbStatus = await this.knex('service_status')
        .select(
          'requested_status as requestedStatus',
          'requested_at as requestedAt'
        )
        .where({ service_name: 'miner' })
        .first();

      if (!dbStatus) {
        dbStatus = initialUserStatus;
      }

      // Check if miner is online
      const online = await this._isMinerOnline(dbStatus);
      online.timestamp = new Date().toISOString();

      return { online };
    } catch (error) {
      throw new GraphQLError(`Failed to check miner status: ${error.message}`);
    }
  }

  // Reset the block found flag
  async resetBlockFoundFlag() {
    try {
      const blockFoundFlagFile = path.resolve(
        __dirname,
        '../../backend/ckpool/logs/BLOCKFOUND.log'
      );

      try {
        // Check if file exists before attempting to delete it
        await fs.access(blockFoundFlagFile, fs.constants.F_OK);
        await fs.unlink(blockFoundFlagFile);
        console.log('Block found flag reset successfully');
      } catch (err) {
        if (err.code !== 'ENOENT') {
          // Only throw if error is not "file not found"
          throw err;
        }
      }
    } catch (error) {
      throw new GraphQLError(`Failed to reset block found flag: ${error.message}`);
    }
  }

  // Helper method to check if miner is online
  async _isMinerOnline(dbStatus) {
    try {
      const statsDir = path.resolve(__dirname, '../../backend/apollo-miner/');
      const statsFilePattern = /^apollo-miner.*$/;

      // Define thresholds
      const recentThresholdMs = 15000; // 15 seconds
      const pendingThresholdMs = 60000; // 60 seconds
      const pendingStopTimeoutMs = 5000; // 5 seconds

      // Get current time
      const currentTime = Date.now();
      const requestedAtTime = dbStatus.requestedAt
        ? new Date(dbStatus.requestedAt).getTime()
        : 0;

      // Check if the directory exists
      try {
        await fs.access(statsDir, fs.constants.F_OK);
      } catch (err) {
        // Directory does not exist
        if (err.code === 'ENOENT') {
          // If request is to start the miner and within pending threshold, return pending
          if (
            dbStatus.requestedStatus === 'online' &&
            currentTime - requestedAtTime <= pendingThresholdMs
          ) {
            return { status: 'pending' };
          }
          // Otherwise, return offline
          return { status: 'offline' };
        }
        throw err;
      }

      // List all files in the directory
      const files = await fs.readdir(statsDir);
      const statsFiles = files.filter((file) => statsFilePattern.test(file));

      // If no stats files, check requested status and pending threshold
      if (statsFiles.length === 0) {
        if (
          dbStatus.requestedStatus === 'online' &&
          currentTime - requestedAtTime <= pendingThresholdMs
        ) {
          return { status: 'pending' };
        }
        return { status: 'offline' };
      }

      // Find the most recently modified file
      let latestFile = null;
      let latestMtime = 0;

      for (const file of statsFiles) {
        const filePath = path.join(statsDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtimeMs > latestMtime) {
          latestMtime = stats.mtimeMs;
          latestFile = filePath;
        }
      }

      if (!latestFile) {
        return { status: 'offline' };
      }

      // Check how recently the file was updated
      const timeSinceLastUpdate = currentTime - latestMtime;

      // Handle case where requested_status is null (e.g., fresh installation)
      // In this case, just check if files are being updated without pending logic
      if (!dbStatus.requestedStatus || dbStatus.requestedStatus === null) {
        if (timeSinceLastUpdate <= recentThresholdMs) {
          return { status: 'online' };
        } else {
          return { status: 'offline' };
        }
      }

      // Determine status based on requested status and file update time
      if (dbStatus.requestedStatus === 'online') {
        if (timeSinceLastUpdate <= recentThresholdMs) {
          return { status: 'online' };
        } else if (currentTime - requestedAtTime <= pendingThresholdMs) {
          return { status: 'pending' };
        } else {
          return { status: 'offline' };
        }
      }

      if (dbStatus.requestedStatus === 'offline') {
        if (timeSinceLastUpdate > recentThresholdMs) {
          return { status: 'offline' };
        } else if (currentTime - requestedAtTime <= pendingStopTimeoutMs) {
          return { status: 'pending' };
        } else {
          return { status: 'offline' };
        }
      }

      return { status: 'error' };
    } catch (error) {
      console.error('Error checking miner status:', error.message);
      return { status: 'error' };
    }
  }

  // Parse a single stat file written by apollo-miner (USB) or apollo-miner-3 (III).
  // Returns the parsed object with int_<key> renaming applied, or null if
  // the file is empty / malformed.
  async _parseStatFileEntry(filePath, fileDetails) {
    try {
      const data = await fs.readFile(filePath);
      let received = data.toString('utf8').trim();

      if (!received) {
        console.log(`Skipping empty file: ${filePath}`);
        return null;
      }

      received = received
        .replace(/\-nan/g, '0')
        .replace(/[^\x00-\x7F]/g, '')
        .replace('}{', '},{')
        .replace(String.fromCharCode(0), '')
        .replace(/[^\}]+$/, '');

      if (!received.startsWith('{') || !received.endsWith('}')) {
        console.log(`Invalid JSON format in file ${filePath}, skipping...`);
        return null;
      }

      try {
        received = JSON.parse(received);
      } catch (parseError) {
        console.log(`Failed to parse JSON in file ${filePath}: ${parseError.message}`);
        return null;
      }

      received.uuid = fileDetails.id;
      received.version = fileDetails.version;

      received.master.intervals = _.mapKeys(
        received.master.intervals,
        (value, name) => `int_${name}`
      );
      received.pool.intervals = _.mapKeys(
        received.pool.intervals,
        (value, name) => `int_${name}`
      );
      received.fans = _.mapKeys(received.fans, (value, name) => `int_${name}`);
      received.slots = _.mapKeys(received.slots, (value, name) => `int_${name}`);

      let offset = new Date().getTimezoneOffset();
      offset *= -1;
      received.date = moment(`${received.date}`, 'YYYY-MM-DD HH:mm:ss')
        .utcOffset(offset)
        .format();

      return received;
    } catch (fileError) {
      console.log(`Error processing file ${filePath}: ${fileError.message}`);
      return null;
    }
  }

  // Helper method to get miner stats
  async _getMinerStats(settings, pools) {
    const stats = [];

    // --- USB boards (apollo-miner) ---
    try {
      const statsDir = path.resolve(__dirname, '../../backend/apollo-miner/');
      const statsFilePattern = /^apollo-miner.*$/;
      let statsFiles = await fs.readdir(statsDir);
      // The Apollo III stat file lives in the same dir but is read separately.
      statsFiles = statsFiles.filter(
        (f) => statsFilePattern.test(f) && f !== 'apollo-miner-3.json'
      );

      const findFileDetails = (fileName) => {
        const match = fileName.match(/^(apollo-miner)(?:-v(\d+))?\.(.+)$/);
        if (match) {
          const [, , version, id] = match;
          const fileVersion = version ? 'v' + version : 'v1';
          return { version: fileVersion, id };
        }
        return null;
      };

      await Promise.all(
        statsFiles.map(async (file) => {
          const details = findFileDetails(file);
          if (!details) {
            console.log(`Could not extract details from filename ${file}, skipping...`);
            return;
          }
          const parsed = await this._parseStatFileEntry(
            `${statsDir}/${file}`,
            details
          );
          if (parsed) stats.push(parsed);
        })
      );
    } catch (err) {
      // Directory may not exist on Solo Node devices with no USB units.
      if (err.code !== 'ENOENT') throw err;
    }

    // --- Apollo III internal hashboards (single stat file) ---
    // One file named `apollo-miner-3.json` (no UID), same schema as Apollo II,
    // written alongside the USB stat files. The backend miner script launches
    // the III binary; there is no separate systemd unit.
    try {
      const iiiStatsDir =
        process.env.APOLLO_III_STATS_DIR ||
        path.resolve(__dirname, '../../backend/apollo-miner/');
      const iiiPath = `${iiiStatsDir}/apollo-miner-3.json`;
      await fs.access(iiiPath);
      const parsed = await this._parseStatFileEntry(iiiPath, {
        version: 'v3',
        id: '3',
      });
      if (parsed) stats.push(parsed);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.log(`Apollo III stats scan failed: ${err.message}`);
      }
    }

    return stats;
  }

  // Helper method to get ckpool stats
  // Enhancement to the _getCkpoolStats method in src/services/node.js

  async _getCkpoolStats(settings, pools) {
    return new Promise((resolve, reject) => {
      (async () => {
        // Get ckpool data
        let ckpoolData = null;
        let blockFound = false;

        try {
          if (settings?.nodeEnableSoloMining) {
            const ckpoolPoolStatsFile = path.resolve(
              __dirname,
              '../../backend/ckpool/logs/pool/pool.status'
            );

            const ckpoolUsersStatsDir = path.resolve(
              __dirname,
              '../../backend/ckpool/logs/users/'
            );

            // Check for block found in ckpool log
            const ckpoolLogFile = path.resolve(
              __dirname,
              '../../backend/ckpool/logs/ckpool.log'
            );

            const blockFoundFlagFile = path.resolve(
              __dirname,
              '../../backend/ckpool/logs/BLOCKFOUND.log'
            );

            try {
              // Check if block found flag exists
              await fs.access(blockFoundFlagFile, fs.constants.F_OK);
              blockFound = true;
            } catch (err) {
              // Flag file doesn't exist, check log for "BLOCK ACCEPTED"
              if (err.code === 'ENOENT') {
                try {
                  const logContent = await fs.readFile(ckpoolLogFile, 'utf8');
                  if (logContent.includes('BLOCK ACCEPTED')) {
                    // Block found! Create the flag file
                    await fs.writeFile(
                      blockFoundFlagFile,
                      new Date().toISOString()
                    );
                    blockFound = true;
                  }
                } catch (logErr) {
                  console.error('Error reading ckpool log:', logErr.message);
                }
              } else {
                throw err;
              }
            }

            try {
              // Check if the directory exists
              await fs.stat(ckpoolUsersStatsDir);
            } catch (err) {
              if (err.code === 'ENOENT') {
                // Directory does not exist
                resolve(ckpoolData); // Resolve with null data
                return;
              }
              throw err; // Re-throw other errors
            }

            // Get list of user files
            let filenames = await fs.readdir(ckpoolUsersStatsDir);
            filenames = filenames.filter(async (filename) => {
              // Skip .DS_Store files
              if (filename.match(/\.ds_store/i)) return false;
              
              // Check file modification time
              const filePath = path.join(ckpoolUsersStatsDir, filename);
              const stats = await fs.stat(filePath);
              const fileAge = Date.now() - stats.mtimeMs;
              const oneDayInMs = 24 * 60 * 60 * 1000;
              
              // Skip files older than 1 day
              return fileAge <= oneDayInMs;
            });
            
            // Wait for all async filter operations to complete
            filenames = await Promise.all(filenames);

            // Process each user file
            const usersDataPromises = filenames.map(async (filename) => {
              try {
                const ckpoolUsersStatsFile = path.join(ckpoolUsersStatsDir, filename);
                const ckpoolUsersData = await fs.readFile(ckpoolUsersStatsFile, 'utf8');
                
                // Skip empty files
                if (!ckpoolUsersData.trim()) {
                  console.log(`Skipping empty solo file: ${filename}`);
                  return null;
                }

                // Clean and validate JSON data
                let cleanedData = ckpoolUsersData
                  .trim()
                  .replace(/\-nan/g, '0')
                  .replace(/[^\x00-\x7F]/g, '')
                  .replace('}{', '},{')
                  .replace(String.fromCharCode(0), '')
                  .replace(/[^\}]+$/, '');

                // Validate JSON structure
                if (!cleanedData.startsWith('{') || !cleanedData.endsWith('}')) {
                  console.log(`Invalid JSON format in solo file ${filename}, skipping...`);
                  return null;
                }

                try {
                  return JSON.parse(cleanedData);
                } catch (parseError) {
                  console.log(`Failed to parse JSON in solo file ${filename}: ${parseError.message}`);
                  return null;
                }
              } catch (fileError) {
                console.log(`Error processing solo file ${filename}: ${fileError.message}`);
                return null;
              }
            });

            const usersData = (await Promise.all(usersDataPromises)).filter(data => data !== null);

            // Parse pool stats file
            let poolData = {};
            try {
              poolData = await this._parseFileToJsonArray(ckpoolPoolStatsFile);
            } catch (poolError) {
              console.log(`Error parsing pool stats file: ${poolError.message}`);
            }

            ckpoolData = {
              pool: poolData,
              users: usersData,
              blockFound: blockFound,
            };
          }

          resolve(ckpoolData);
        } catch (err) {
          reject(err);
        }
      })();
    });
  }

  // Helper method to parse file to JSON array
  async _parseFileToJsonArray(filePath) {
    try {
      // Read the file content
      const fileContent = await fs.readFile(filePath, 'utf8');

      // Divide the file content into lines
      const lines = fileContent.split('\n');

      const allKeys = {};

      // Analyze each line
      lines.forEach((line) => {
        if (line.trim() !== '') {
          try {
            const jsonObject = JSON.parse(line);

            // Add the keys to the allKeys object
            Object.entries(jsonObject).forEach(([key, value]) => {
              if (!allKeys[key]) {
                allKeys[key] = null;
              }
              allKeys[key] = value;
            });
          } catch (error) {
            console.error(
              `Error during the parsing of the line: ${error.message}`
            );
          }
        }
      });

      return allKeys;
    } catch (error) {
      console.error(`Error during the reading of the file: ${error.message}`);
      return {};
    }
  }

  // Helper method to execute shell commands
  _execCommand(command) {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.trim());
      });
    });
  }
}

module.exports = (knex, utils) => new MinerService(knex, utils);
