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
  async start() {
    try {
      // Update service status in the database
      await this.knex('service_status')
        .where({ service_name: 'miner' })
        .update({
          status: 'pending',
          requested_status: 'online',
          requested_at: new Date(),
        });

      // Start the miner based on environment
      if (process.env.NODE_ENV === 'development') {
        console.log('Starting dev miner...');
        await devMinerService.startDevMiner();
      } else {
        await this._execCommand('sudo systemctl start apollo-miner');
      }
    } catch (error) {
      throw new GraphQLError(`Failed to start miner: ${error.message}`);
    }
  }

  // Stop the miner
  async stop() {
    try {
      // Update service status in the database
      await this.knex('service_status')
        .where({ service_name: 'miner' })
        .update({
          status: 'pending',
          requested_status: 'offline',
          requested_at: new Date(),
        });

      // Stop the miner based on environment
      if (process.env.NODE_ENV === 'development') {
        console.log('Stopping dev miner...');
        await devMinerService.stopDevMiner();
      } else {
        await this._execCommand('sudo systemctl stop apollo-miner');
      }
    } catch (error) {
      throw new GraphQLError(`Failed to stop miner: ${error.message}`);
    }
  }

  // Restart the miner
  async restart() {
    try {
      // Update service status in the database
      await this.knex('service_status')
        .where({ service_name: 'miner' })
        .update({
          status: 'pending',
          requested_status: 'online',
          requested_at: new Date(),
        });

      // Restart the miner based on environment
      if (process.env.NODE_ENV === 'development') {
        console.log('Restarting dev miner...');
        await devMinerService.restartDevMiner();
      } else {
        await this._execCommand('sudo systemctl restart apollo-miner');
      }
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

  // Helper method to get miner stats
  async _getMinerStats(settings, pools) {
    return new Promise((resolve, reject) => {
      (async () => {
        try {
          const statsDir = path.resolve(
            __dirname,
            '../../backend/apollo-miner/'
          );
          const statsFilePattern = 'apollo-miner.*';

          // Get list of stats files
          let statsFiles = await fs.readdir(statsDir);
          statsFiles = statsFiles.filter((f) => f.match(statsFilePattern));

          let stats = [];

          // Parse file details (version and ID)
          const findFileDetails = (fileName) => {
            const match = fileName.match(/^(apollo-miner)(?:-v(\d+))?\.(.+)$/);
            if (match) {
              const [, , version, id] = match;
              const fileVersion = version ? 'v' + version : 'v1';
              return { version: fileVersion, id };
            } else {
              return null;
            }
          };

          // Process each stats file
          await Promise.all(
            statsFiles.map(async (file) => {
              try {
                const data = await fs.readFile(`${statsDir}/${file}`);
                let received = data.toString('utf8').trim();

                // Skip empty files
                if (!received) {
                  console.log(`Skipping empty file: ${file}`);
                  return;
                }

                // Clean JSON data
                received = received
                  .replace(/\-nan/g, '0')
                  .replace(/[^\x00-\x7F]/g, '')
                  .replace('}{', '},{')
                  .replace(String.fromCharCode(0), '')
                  .replace(/[^\}]+$/, '');

                // Validate JSON before parsing
                if (!received.startsWith('{') || !received.endsWith('}')) {
                  console.log(`Invalid JSON format in file ${file}, skipping...`);
                  return;
                }

                try {
                  received = JSON.parse(received);
                } catch (parseError) {
                  console.log(`Failed to parse JSON in file ${file}: ${parseError.message}`);
                  return;
                }

                // Add file details to the stats
                const fileDetails = findFileDetails(file);
                if (!fileDetails) {
                  console.log(`Could not extract details from filename ${file}, skipping...`);
                  return;
                }

                received.uuid = fileDetails.id;
                received.version = fileDetails.version;

                // Rename interval keys
                received.master.intervals = _.mapKeys(
                  received.master.intervals,
                  (value, name) => `int_${name}`
                );

                received.pool.intervals = _.mapKeys(
                  received.pool.intervals,
                  (value, name) => `int_${name}`
                );

                received.fans = _.mapKeys(
                  received.fans,
                  (value, name) => `int_${name}`
                );

                received.slots = _.mapKeys(
                  received.slots,
                  (value, name) => `int_${name}`
                );

                // Format date with timezone
                let offset = new Date().getTimezoneOffset();
                offset *= -1;
                received.date = moment(`${received.date}`, 'YYYY-MM-DD HH:mm:ss')
                  .utcOffset(offset)
                  .format();

                stats.push(received);
              } catch (fileError) {
                console.log(`Error processing file ${file}: ${fileError.message}`);
                // Continue with other files instead of failing completely
              }
            })
          );

          resolve(stats);
        } catch (err) {
          reject(err);
        }
      })();
    });
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
                  console.log(`Skipping empty ckpool file: ${filename}`);
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
                  console.log(`Invalid JSON format in ckpool file ${filename}, skipping...`);
                  return null;
                }

                try {
                  return JSON.parse(cleanedData);
                } catch (parseError) {
                  console.log(`Failed to parse JSON in ckpool file ${filename}: ${parseError.message}`);
                  return null;
                }
              } catch (fileError) {
                console.log(`Error processing ckpool file ${filename}: ${fileError.message}`);
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
