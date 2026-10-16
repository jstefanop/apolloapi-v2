const { exec } = require('child_process');

// How long after ckpool starts a figure may still be one it restored from disk
// rather than one it just found.
const RESTORE_WINDOW_SECONDS = 60;
const { GraphQLError } = require('graphql');
const transition = require('./transition');
const fs = require('fs').promises;
const path = require('path');

// Import the dev solo service for development mode
const devSoloService =
  process.env.NODE_ENV === 'development' ? require('../devSoloService') : null;

class SoloService {
  constructor(knex, utils) {
    this.knex = knex;
    this.utils = utils;
    // Read from the table once and kept here, so the common case — a share that
    // does not beat the record — costs a comparison and no query, on a method
    // the scheduler calls every five seconds.
    this._bestShareEver = null;
  }

  // The best share the device has ever found. ckpool's own figures cannot
  // answer this: the pool-level one restarts with the process, and the per-user
  // one lives in a file we drop once it is a day old.
  async _loadBestShareEver() {
    if (this._bestShareEver) return this._bestShareEver;
    if (!this.knex) return { value: 0, at: null };

    try {
      const row = await this.knex('solo_best_share').where({ id: 1 }).first();
      this._bestShareEver = {
        value: row?.best_share || 0,
        at: row?.found_at || null,
      };
    } catch (error) {
      // A device mid-migration still has to report its current share. Cache the
      // empty answer as well: this runs on every five-second push, and an
      // unreadable table would otherwise print this line for ever.
      console.error('Error reading best share ever:', error.message);
      this._bestShareEver = { value: 0, at: null };
    }

    return this._bestShareEver;
  }

  // Raise the record if this sample beat it. Only ever upwards: a ckpool that
  // has just restarted reports zero, and that is not a new record of zero.
  async _recordBestShare(ckpoolData) {
    const best = await this._loadBestShareEver();
    // Same guard as the read path. Without it a device with no database logs a
    // failure every five seconds, for ever.
    if (!this.knex) return best;

    const fromPool = Number(ckpoolData?.pool?.bestshare) || 0;
    // A user entry carries ckpool's own persisted best, which survives its
    // restarts — it covers the window where the pool figure is back at zero but
    // the device has already found something.
    const fromUsers = (ckpoolData?.users || []).reduce(
      (max, user) => Math.max(max, Number(user?.bestever) || 0),
      0
    );
    const candidate = Math.max(fromPool, fromUsers);

    if (!(candidate > best.value)) return best;

    // A date only when we watched the record being set, and ckpool's own
    // runtime is the only thing that can tell us.
    //
    // Everything else lies at the wrong moment. A restart restores the figure
    // from logs/users into *both* the pool status and the user file, so neither
    // source betrays it; and "we already knew a record, so this rise is new" is
    // wrong precisely when it matters — an upgraded device seeded from the
    // 30-day time series meets its older, larger all-time record two seconds
    // after ckpool starts, and would stamp it with today.
    //
    // Past the first minute of runtime a rise cannot be a restore: it happened
    // while we were watching. Before that we say nothing rather than guess. The
    // cost is a genuine record found in ckpool's first minute going undated.
    const runtime = Number(ckpoolData?.pool?.runtime) || 0;
    const at =
      runtime > RESTORE_WINDOW_SECONDS ? new Date().toISOString() : null;

    try {
      // One statement, and conditional on what is stored rather than on what
      // this instance last read. getStats runs from two schedulers at once —
      // the push every 5 s and the time series every 60 s — and each reads
      // pool.status for itself, so the slower one can arrive last carrying the
      // smaller figure and undo the record. The upsert also covers the row not
      // being there at all, which a plain update reports as nothing happening.
      // `found_at` moves with `best_share`, null included. A date describes the
      // record it was taken for, so carrying it onto a larger one would date a
      // share that was never found then — and keeping it is not needed to guard
      // against a bad read, because the WHERE below already refuses any
      // candidate that does not beat what is stored.
      await this.knex('solo_best_share')
        .insert({ id: 1, best_share: candidate, found_at: at })
        .onConflict('id')
        .merge(['best_share', 'found_at'])
        .where('solo_best_share.best_share', '<', candidate);
    } catch (error) {
      console.error('Error saving best share ever:', error.message);
      return best;
    }

    // Read back rather than assume: the write is allowed to be declined.
    this._bestShareEver = null;
    return this._loadBestShareEver();
  }

  _notifyServicesStatus() {
    try {
      const { pushServicesStatus } = require('../app/scheduler');
      pushServicesStatus().catch(() => {});
    } catch (_) {}
  }

  // Start the solo pool (ckpool)
  async start() {
    try {
      if (process.env.NODE_ENV === 'development') {
        await this._devTransition('online', async () => {
          console.log('Starting dev solo pool...');
          await devSoloService.startDevSolo();
        });
      } else {
        await this._requestSystemd('online', 'sudo systemctl start --no-block ckpool');
        // --no-block returns once the job is queued, so the pool is not up yet.
        // Waiting for it here is what lets the row go to `online` the moment it
        // is, instead of after the monitor's next look.
        const becameActive = await this._waitForActive();
        if (!becameActive) {
          await this._updateServiceStatus('offline');
          throw new GraphQLError('Solo pool start timed out: service did not become active');
        }
      }

      // Update status to online after successful start
      await this._updateServiceStatus('online');
    } catch (error) {
      throw this._asFailure('start', error);
    }
  }

  // Stop the solo pool (ckpool)
  async stop() {
    try {
      if (process.env.NODE_ENV === 'development') {
        await this._devTransition('offline', async () => {
          console.log('Stopping dev solo pool...');
          await devSoloService.stopDevSolo();
        });
        await this._updateServiceStatus('offline');
      } else {
        await this._requestSystemd('offline', 'sudo systemctl stop --no-block ckpool');
        // The stop was only queued. The row stays `pending` until the pool is
        // really down; if it is slow, the monitor closes the transition.
        if (await this._waitForInactive()) await this._updateServiceStatus('offline');
      }
    } catch (error) {
      throw this._asFailure('stop', error);
    }
  }

  // Restart the solo pool (ckpool)
  async restart() {
    try {
      if (process.env.NODE_ENV === 'development') {
        await this._devTransition('online', async () => {
          console.log('Restarting dev solo pool...');
          await devSoloService.restartDevSolo();
        });
      } else {
        await this._requestSystemd('online', 'sudo systemctl restart --no-block ckpool');
        // Wait for service to be actually active before marking online (avoids "stoppato ma non riavviato" / connection issue in UI)
        const becameActive = await this._waitForActive();
        if (!becameActive) {
          await this._updateServiceStatus('offline');
          throw new GraphQLError('Solo pool restart timed out: service did not become active');
        }
      }

      // Update status to online after successful restart
      await this._updateServiceStatus('online');
    } catch (error) {
      throw this._asFailure('restart', error);
    }
  }

  // Ask systemd for a transition. Written to service_status first and published
  // once accepted; put back if refused (see transition.js).
  async _requestSystemd(requested, command) {
    const action = command.includes(' stop ') ? 'stop' : command.includes(' restart ') ? 'restart' : 'start';
    try {
      if (!this.knex) return await this._execCommand(command);
      return await transition.run(this.knex, 'solo', requested, () => this._execCommand(command), {
        notify: () => this._notifyServicesStatus(),
      });
    } catch (error) {
      throw transition.refused('solo', action, error);
    }
  }

  // Dev: no systemd and no monitor, so the work is the dev service's own; same
  // bookkeeping as in production, announced once it ran.
  _devTransition(requested, work) {
    if (!this.knex) return work();
    return transition.run(this.knex, 'solo', requested, work, {
      notify: () => this._notifyServicesStatus(),
    });
  }

  // A refused command carries a clean, localisable error already (the detail is
  // in the log); anything else here is one of our own messages (a timeout).
  _asFailure(action, error) {
    if (error?.extensions?.code === 'SERVICE_COMMAND_FAILED') return error;
    return new GraphQLError(`Failed to ${action} solo pool: ${error.message}`);
  }

  // Get solo pool status
  async getStatus() {
    try {
      let status;
      if (process.env.NODE_ENV === 'development') {
        status = devSoloService.getStatus();
      } else {
        const { stdout } = await this._execCommand('systemctl is-active ckpool');
        status = stdout.trim();
      }

      // Update last_checked timestamp
      await this._updateLastChecked();

      return status;
    } catch (error) {
      // Update last_checked even on error
      await this._updateLastChecked();
      return 'inactive';
    }
  }

  // Get solo pool statistics
  async getStats() {
    try {
      // Get basic service status
      const status = await this.getStatus();

      // Keep publishing status while ckpool is stopped, but do not poll files
      // that only exist after the service has started.
      let ckpoolData = {
        pool: null,
        users: [],
        blockFound: false,
      };
      if (status === 'active' || status === 'running') {
        try {
          ckpoolData = await this._getCkpoolStats();
        } catch (ckpoolError) {
          console.error('Error getting solo stats:', ckpoolError);
          // Continue with empty ckpool data instead of failing completely
        }
      }

      // Recorded here rather than in the scheduler's minute-by-minute sampling:
      // this runs on every push, so a record set shortly before a ckpool restart
      // is not lost with it.
      const bestShareEver = await this._recordBestShare(ckpoolData);

      // Build the stats object
      const stats = {
        status,
        ...ckpoolData,
        bestShareEver,
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
            console.error('Error reading solo log:', logErr.message);
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
                console.log(`Invalid JSON format in solo file ${filename}, skipping...`);
                return null;
              }

              return JSON.parse(cleanedData);
            } catch (fileError) {
              console.log(`Error processing solo file ${filename}: ${fileError.message}`);
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

  // Helper method to update service status
  async _updateServiceStatus(newStatus) {
    try {
      if (this.knex) {
        await this.knex('service_status')
          .where({ service_name: 'solo' })
          .update({
            status: newStatus,
            last_checked: Date.now()
          });
        // The end of the transition is a state change like the start of it, and
        // it was the only one nobody announced. Going into `pending` published;
        // arriving at online or offline did not, and the monitor that would
        // otherwise have noticed finds the row already up to date and says
        // nothing. The UI then held a stopped pool on screen for up to ten
        // seconds — the next periodic push — while its statistics were already
        // arriving every five.
        this._notifyServicesStatus();
      }
    } catch (error) {
      console.error('Error updating service status:', error);
    }
  }

  // Helper method to update last_checked timestamp
  async _updateLastChecked() {
    try {
      if (this.knex) {
        await this.knex('service_status')
          .where({ service_name: 'solo' })
          .update({
            last_checked: Date.now()
          });
      }
    } catch (error) {
      console.error('Error updating last_checked:', error);
    }
  }

  /**
   * Wait for ckpool to become active after start/restart (production only).
   * Polls systemctl is-active until 'active' or timeout. Keeps DB as 'pending' so
   * the service monitor grace period applies and the UI doesn't show "offline but should be online".
   * @param {number} timeoutMs - Max wait in ms
   * @param {number} pollIntervalMs - Interval between checks
   * @returns {Promise<boolean>} - true if active, false if timeout
   */
  async _waitForActive(timeoutMs = 30000, pollIntervalMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const { stdout } = await this._execCommand('systemctl is-active ckpool');
        const status = (stdout && stdout.trim()) || '';
        if (status === 'active') return true;
        if (status === 'failed') return false;
        // activating, inactive, etc. -> keep waiting
      } catch (err) {
        // is-active exits non-zero when not active; keep polling
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    return false;
  }

  /**
   * Wait for ckpool to be down after a stop (production only). Polls
   * systemctl is-active until it says inactive or failed. A timeout is not an
   * error: the stop was accepted and the service monitor closes the transition.
   * @returns {Promise<boolean>} true once it is down
   */
  async _waitForInactive(timeoutMs = 30000, pollIntervalMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const { stdout } = await this._execCommand('systemctl is-active ckpool');
        const status = (stdout && stdout.trim()) || '';
        if (status === 'inactive' || status === 'failed') return true;
      } catch (err) {
        // is-active exits non-zero when it is not active: that is the answer.
        if (err && /inactive|failed/.test(`${err.stdout || ''}${err.message || ''}`)) return true;
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    return false;
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
