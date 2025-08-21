const { exec } = require('child_process');
const { GraphQLError } = require('graphql');
const fs = require('fs').promises;
const path = require('path');

// Import the dev solo service for development mode
const devSoloService =
  process.env.NODE_ENV === 'development' ? require('../devSoloService') : null;

class SoloService {
  constructor(knex, utils) {
    this.knex = knex;
    this.utils = utils;
  }

  // Start the solo pool (ckpool)
  async start() {
    try {
      // Update service status in the database
      await this.knex('service_status')
        .where({ service_name: 'solo' })
        .update({
          status: 'pending',
          requested_status: 'online',
          requested_at: new Date(),
        });

      // Start the solo pool based on environment
      if (process.env.NODE_ENV === 'development') {
        console.log('Starting dev solo pool...');
        await devSoloService.startDevSolo();
      } else {
        await this._execCommand('sudo systemctl start ckpool');
      }
    } catch (error) {
      throw new GraphQLError(`Failed to start solo pool: ${error.message}`);
    }
  }

  // Stop the solo pool (ckpool)
  async stop() {
    try {
      // Update service status in the database
      await this.knex('service_status')
        .where({ service_name: 'solo' })
        .update({
          status: 'pending',
          requested_status: 'offline',
          requested_at: new Date(),
        });

      // Stop the solo pool based on environment
      if (process.env.NODE_ENV === 'development') {
        console.log('Stopping dev solo pool...');
        await devSoloService.stopDevSolo();
      } else {
        await this._execCommand('sudo systemctl stop ckpool');
      }
    } catch (error) {
      throw new GraphQLError(`Failed to stop solo pool: ${error.message}`);
    }
  }

  // Restart the solo pool (ckpool)
  async restart() {
    try {
      // Update service status in the database
      await this.knex('service_status')
        .where({ service_name: 'solo' })
        .update({
          status: 'pending',
          requested_status: 'online',
          requested_at: new Date(),
        });

      // Restart the solo pool based on environment
      if (process.env.NODE_ENV === 'development') {
        console.log('Restarting dev solo pool...');
        await devSoloService.restartDevSolo();
      } else {
        await this._execCommand('sudo systemctl restart ckpool');
      }
    } catch (error) {
      throw new GraphQLError(`Failed to restart solo pool: ${error.message}`);
    }
  }

  // Get solo pool status
  async getStatus() {
    try {
      if (process.env.NODE_ENV === 'development') {
        return devSoloService.getStatus();
      } else {
        const { stdout } = await this._execCommand('systemctl is-active ckpool');
        return stdout.trim();
      }
    } catch (error) {
      return 'inactive';
    }
  }

  // Get solo pool statistics
  async getStats() {
    try {
      // Get basic service status
      const status = await this.getStatus();
      
      // Get ckpool statistics by parsing the log files
      let ckpoolData = null;
      try {
        ckpoolData = await this._getCkpoolStats();
      } catch (ckpoolError) {
        console.error('Error getting ckpool stats:', ckpoolError);
        // Continue with null ckpool data instead of failing completely
      }

      // Build the stats object
      const stats = {
        status,
        ...ckpoolData,
        timestamp: new Date().toISOString(),
        error: null,
      };

      return stats;
    } catch (error) {
      const stats = {
        error: {
          code: error.code || 'UNKNOWN',
          message: error.message,
        },
        timestamp: new Date().toISOString(),
      };

      return { stats };
    }
  }

    // Helper method to get ckpool stats
  async _getCkpoolStats() {
    try {
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

      let blockFound = false;
      let poolData = {};
      let usersData = [];

      // Check if block found flag exists
      try {
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
        }
      }

      // Parse pool stats file
      try {
        poolData = await this._parseFileToJsonArray(ckpoolPoolStatsFile);
      } catch (poolError) {
        console.log(`Error parsing pool stats file: ${poolError.message}`);
      }

      // Get users data
      try {
        const usersDirExists = await fs.stat(ckpoolUsersStatsDir);
        if (usersDirExists.isDirectory()) {
          const filenames = await fs.readdir(ckpoolUsersStatsDir);
          
          // Filter out .DS_Store and process files
          const validFiles = filenames.filter(filename => 
            !filename.match(/\.ds_store/i) && 
            !filename.startsWith('.')
          );

          // Process each user file
          const usersDataPromises = validFiles.map(async (filename) => {
            try {
              const filePath = path.join(ckpoolUsersStatsDir, filename);
              const fileStats = await fs.stat(filePath);
              
              // Skip files older than 1 day
              const fileAge = Date.now() - fileStats.mtimeMs;
              const oneDayInMs = 24 * 60 * 60 * 1000;
              if (fileAge > oneDayInMs) {
                return null;
              }

              const content = await fs.readFile(filePath, 'utf8');
              
              // Skip empty files
              if (!content.trim()) {
                return null;
              }

              // Clean and validate JSON data
              let cleanedData = content
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

              return JSON.parse(cleanedData);
            } catch (fileError) {
              console.log(`Error processing ckpool file ${filename}: ${fileError.message}`);
              return null;
            }
          });

          usersData = (await Promise.all(usersDataPromises)).filter(data => data !== null);
        }
      } catch (dirError) {
        if (dirError.code !== 'ENOENT') {
          console.error('Error accessing users directory:', dirError.message);
        }
      }

      return {
        pool: poolData,
        users: usersData,
        blockFound: blockFound,
      };
    } catch (error) {
      console.error('Error in _getCkpoolStats:', error);
      return {
        pool: {},
        users: [],
        blockFound: false,
      };
    }
  }

  // Helper method to parse file to JSON array
  async _parseFileToJsonArray(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.trim().split('\n');
      
      if (lines.length >= 3) {
        const poolStatus = JSON.parse(lines[0]);
        const hashrateStats = JSON.parse(lines[1]);
        const shareStats = JSON.parse(lines[2]);
        
        return {
          runtime: poolStatus.runtime || 0,
          lastupdate: poolStatus.lastupdate || 0,
          Users: poolStatus.Users || 0,
          Workers: poolStatus.Workers || 0,
          Idle: poolStatus.Idle || 0,
          Disconnected: poolStatus.Disconnected || 0,
          hashrate1m: hashrateStats.hashrate1m || '0T',
          hashrate5m: hashrateStats.hashrate5m || '0T',
          hashrate15m: hashrateStats.hashrate15m || '0T',
          hashrate1hr: hashrateStats.hashrate1hr || '0T',
          hashrate6hr: hashrateStats.hashrate6hr || '0T',
          hashrate1d: hashrateStats.hashrate1d || '0G',
          hashrate7d: hashrateStats.hashrate7d || '0G',
          diff: shareStats.diff || 0,
          accepted: shareStats.accepted || 0,
          rejected: shareStats.rejected || 0,
          bestshare: shareStats.bestshare || 0,
          SPS1m: shareStats.SPS1m || 0,
          SPS5m: shareStats.SPS5m || 0,
          SPS15m: shareStats.SPS15m || 0,
          SPS1h: shareStats.SPS1h || 0
        };
      }
      
      return {};
    } catch (error) {
      console.error(`Error parsing file ${filePath}:`, error);
      return {};
    }
  }

  // Helper method to execute shell commands
  async _execCommand(command) {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        if (stderr) {
          console.warn(`Command stderr: ${stderr}`);
        }
        resolve({ stdout, stderr });
      });
    });
  }
}

module.exports = (knex, utils) => new SoloService(knex, utils);
