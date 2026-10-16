const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { exec, spawn } = require('child_process');
const generator = require('generate-password');
const config = require('config');
const { knex } = require('./db');
const { assertPasswordSafe } = require('./passwordPolicy');
const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');
const util = require('util');

const CHPASSWD_TIMEOUT_MS = 30000;

// Convert exec to use promises
const execPromise = util.promisify(exec);

// Helper function to check if we're in production environment
const isProduction = () => process.env.NODE_ENV === 'production';

// Path configuration for Bitcoin and ckpool
// Note: bitcoin.conf is now managed by node_start.sh - we only manage api.conf and user.conf
const configBitcoinApiConfPath = path.resolve(
  __dirname,
  '../backend/node/api.conf'
);

const configBitcoinUserConfPath = path.resolve(
  __dirname,
  '../backend/node/user.conf'
);

const configCkpoolFilePath = path.resolve(
  __dirname,
  '../backend/ckpool/ckpool.conf'
);

// Helper function to execute commands with sudo only in production.
//
// Logs the program, never the command line: arguments are where secrets end up
// (this once printed the node RPC password into the journal), and the error
// message exec produces repeats the whole command too.
const execWithSudo = async (command) => {
  const program = String(command).trim().split(/\s+/)[0];
  try {
    const cmdToRun = isProduction()
      ? `sudo ${command}`
      : command;

    console.log(`Executing command: ${program}`);
    const { stdout, stderr } = await execPromise(cmdToRun);

    if (stderr) {
      console.error(`Command stderr: ${stderr}`);
    }

    return stdout.trim();
  } catch (error) {
    if (!isProduction()) {
      console.log(`Command would fail in production: ${program}`);
      return "dev-mode-success";
    }
    throw error;
  }
};

// Config files that carry a secret are edited through fs, not through a shell
// `sed` with the secret in its argument list: argv is readable by every user in
// `ps`. A file the service user cannot touch (root-owned) falls back to
// `sudo cat` / `sudo tee`, where the content travels on stdin / stdout instead.
const PERMISSION_ERRORS = ['EACCES', 'EPERM'];

// null only for a file that is not there. Any other failure — unreadable,
// I/O error — propagates: reading it as "missing" would have the caller write a
// fresh minimal file over a configuration it simply could not read.
const readConfFile = async (file) => {
  try {
    await fsPromises.access(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    return await fsPromises.readFile(file, 'utf8');
  } catch (error) {
    if (!isProduction() || !PERMISSION_ERRORS.includes(error.code)) throw error;
    return execWithSudo(`cat ${file}`);
  }
};

const sudoTee = (file, content) =>
  new Promise((resolve, reject) => {
    const child = spawn('sudo', ['tee', file], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    // An EPIPE here (tee died before reading) would otherwise be an unhandled
    // 'error' event on the stream and take the process down.
    child.stdin.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `tee exited with code ${code}`))
    );
    child.stdin.write(content);
    child.stdin.end();
  });

// Replace a conf file whole or not at all: write the new content beside it, then
// rename over it. A write cut short (disk full, killed process) leaves the old
// file intact instead of a truncated one that bitcoind or ckpool then reads.
// `mode` is for a file that does not exist yet; an existing one keeps its own.
const writeConfFile = async (file, content, { mode = 0o600 } = {}) => {
  let fileMode = mode;
  try {
    const st = await fsPromises.stat(file);
    if (typeof st?.mode === 'number') fileMode = st.mode & 0o777;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsPromises.writeFile(temp, content, { mode: fileMode });
    await fsPromises.rename(temp, file);
  } catch (error) {
    try {
      await fsPromises.unlink(temp);
    } catch (_) {
      // Nothing to clean up, or nothing that can be.
    }
    // No room to create files in that directory (it belongs to root): the
    // fallback writes the file in place, which is the one thing sudo can do here
    // without changing who owns it.
    if (!isProduction() || !PERMISSION_ERRORS.includes(error.code)) throw error;
    await sudoTee(file, content);
  }
};

// Helper function to mock systemctl commands in development
const mockSystemctl = async (action, service) => {
  if (isProduction()) {
    return execWithSudo(`systemctl ${action} ${service}`);
  } else {
    console.log(`[DEV] Mock systemctl ${action} ${service}`);
    return `[DEV] systemctl ${action} ${service} - success`;
  }
};

module.exports.auth = {
  // Hash a password using bcrypt
  hashPassword(password) {
    return bcrypt.hash(password, 12);
  },

  // Compare a password with a stored hash
  comparePassword(password, hash) {
    if (!password || !hash) {
      return false;
    }
    return bcrypt.compare(password, hash);
  },

  // Change the system user password (stdin only — never interpolate password into a shell string)
  async changeSystemPassword(password) {
    // Defence in depth: the auth service already refuses these, but this is the
    // function that writes to chpasswd, so it must not trust its callers.
    assertPasswordSafe(password);
    if (!isProduction()) {
      console.log(`[DEV] Would change system password for user 'futurebit'`);
      return;
    }
    await new Promise((resolve, reject) => {
      // chpasswd reads one "user:password" entry per LINE from stdin. No shell, so quotes cannot inject
      // commands, but a line break WOULD inject a second entry (e.g. "root:..."): assertPasswordSafe above
      // refuses \n, \r and NUL before we get here.
      const child = spawn('sudo', ['chpasswd'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      // A chpasswd that never exits would hold the auth lock — and with it every
      // later setup and password change — for ever.
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(reject, new Error(`chpasswd did not finish within ${CHPASSWD_TIMEOUT_MS / 1000}s`));
      }, CHPASSWD_TIMEOUT_MS);
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => finish(reject, error));
      // EPIPE when chpasswd dies before reading its input.
      child.stdin.on('error', (error) => finish(reject, error));
      child.on('close', (code) => {
        if (code !== 0) {
          finish(reject, new Error(stderr.trim() || `chpasswd exited with code ${code}`));
        } else {
          finish(resolve);
        }
      });
      child.stdin.write(`futurebit:${password}\n`);
      child.stdin.end();
    });
  },

  // Generate and save a new RPC password for Bitcoin node
  async changeNodeRpcPassword(settings) {
    try {
      console.log('Generating and saving bitcoin password');

      // Generate a random password
      const password = generator.generate({
        length: 12,
        numbers: true,
      });

      // Update the password only on the latest settings row (append-only table;
      // updating without WHERE would overwrite every historical row).
      const latestSettings = await knex('settings')
        .select('id')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .first();

      if (latestSettings) {
        await knex('settings')
          .where('id', latestSettings.id)
          .update({ node_rpc_password: password });
      } else {
        console.warn('changeNodeRpcPassword: no settings row found, skipping DB update');
      }

      try {
        // Create directories if needed
        const bitcoinDir = path.dirname(configBitcoinApiConfPath);
        const ckpoolDir = path.dirname(configCkpoolFilePath);

        await fsPromises.mkdir(bitcoinDir, { recursive: true });
        await fsPromises.mkdir(ckpoolDir, { recursive: true });

        // The replacers are functions, so a `$` in a password is never read as a
        // back-reference.
        // api.conf: replace the existing line, or create the file. A file that is
        // there but cannot be read stops here (see readConfFile).
        const apiConf = await readConfFile(configBitcoinApiConfPath);
        if (apiConf !== null) {
          await writeConfFile(
            configBitcoinApiConfPath,
            apiConf.replace(/rpcpassword.*/g, () => `rpcpassword=${password}`)
          );
        } else {
          // Only the user running the API, bitcoind and ckpool (all `futurebit`)
          // ever read these files, so a file created here is owner-only.
          await writeConfFile(configBitcoinApiConfPath, `rpcpassword=${password}\n`, { mode: 0o600 });
          console.log('Created api.conf with new password');
        }

        // ckpool.conf: same.
        const ckpoolConf = await readConfFile(configCkpoolFilePath);
        if (ckpoolConf !== null) {
          await writeConfFile(
            configCkpoolFilePath,
            ckpoolConf.replace(/"pass":.*/g, () => `"pass": "${password}",`)
          );
        } else {
          const ckpoolConfig = `{\n  "btcd": [\n    {\n      "url": "127.0.0.1:8332",\n      "auth": "futurebit",\n      "pass": "${password}",\n      "notify": true\n    }\n  ]\n}`;
          await writeConfFile(configCkpoolFilePath, ckpoolConfig, { mode: 0o600 });
          console.log('Created ckpool.conf');
        }

        // Restart the node service
        await mockSystemctl('restart', 'node');

        // Restart ckpool if solo mining is enabled
        if (settings?.nodeEnableSoloMining) {
          await mockSystemctl('restart', 'ckpool');
        }

        console.log('Password updated successfully in api.conf and ckpool.conf');
      } catch (err) {
        console.log('Error updating configuration files:', err.message);
      }
    } catch (err) {
      console.log('Error in changeNodeRpcPassword:', err.message);
    }
  },

  // Generate a JWT access token
  generateAccessToken() {
    const accessToken = jwt.sign({}, config.get('server.secret'), {
      subject: 'apollouser',
      audience: 'auth',
    });
    return {
      accessToken,
    };
  },

  // Calculate network address with CIDR notation
  networkAddressWithCIDR(ipAddress, netmask) {
    // Convert IP address and netmask to binary form
    const ipBinary = ipAddress
      .split('.')
      .map((part) => parseInt(part, 10).toString(2).padStart(8, '0'))
      .join('');
    const netmaskBinary = netmask
      .split('.')
      .map((part) => parseInt(part, 10).toString(2).padStart(8, '0'))
      .join('');

    // Apply bitwise AND operation
    const networkBinary = ipBinary
      .split('')
      .map((bit, index) => bit & netmaskBinary[index])
      .join('');

    // Convert the result to string form
    const networkAddress = networkBinary
      .match(/.{1,8}/g)
      .map((byte) => parseInt(byte, 2))
      .join('.');

    // Calculate the number of netmask bits
    const cidrPrefix = netmask
      .split('.')
      .reduce(
        (acc, byte) =>
          acc + (parseInt(byte, 10).toString(2).match(/1/g) || '').length,
        0
      );

    return `${networkAddress}/${cidrPrefix}`;
  },

  // Get the system's network information
  getSystemNetwork() {
    // Get network interface information
    const interfaces = os.networkInterfaces();
    let address = null;
    let netmask = null;
    let network = null;

    // Check if wlan0 has an associated IP address
    if (
      interfaces['wlan0'] &&
      interfaces['wlan0'].some((info) => info.family === 'IPv4')
    ) {
      // If wlan0 has an associated IP address, use wlan0
      address = interfaces['wlan0'].find(
        (info) => info.family === 'IPv4'
      ).address;
      netmask = interfaces['wlan0'].find(
        (info) => info.family === 'IPv4'
      ).netmask;
    } else if (
      interfaces['eth0'] &&
      interfaces['eth0'].some((info) => info.family === 'IPv4')
    ) {
      // If wlan0 doesn't have an associated IP address but eth0 does, use eth0
      address = interfaces['eth0'].find(
        (info) => info.family === 'IPv4'
      ).address;
      netmask = interfaces['eth0'].find(
        (info) => info.family === 'IPv4'
      ).netmask;
    } else if (!isProduction()) {
      // For development on Mac, try to find en0 (typical Mac wireless)
      for (const [iface, addresses] of Object.entries(interfaces)) {
        if (iface.startsWith('en') && addresses.some(info => info.family === 'IPv4')) {
          address = addresses.find(info => info.family === 'IPv4').address;
          netmask = addresses.find(info => info.family === 'IPv4').netmask;
          break;
        }
      }
      if (!address) {
        console.log('Using localhost for development mode');
        address = '127.0.0.1';
        netmask = '255.0.0.0';
      }
    } else {
      console.log('No IP address associated with wlan0 or eth0');
    }

    if (address && netmask)
      network = this.networkAddressWithCIDR(address, netmask);

    return network;
  },

  // Manage ckpool configuration
  async manageCkpoolConf(settings) {
    try {
      // Ensure settings is valid
      if (!settings) {
        console.log('No settings found for solo configuration');
        return;
      }

      // Create ckpool configuration
      // btcsig is stored as user-customizable part only, compose full signature here
      const userBtcsig = settings.btcsig || 'mined by Solo Apollo';
      const fullBtcsig = `/FutureBit-${userBtcsig}/`;
      
      const ckpoolConf = {
        btcd: [
          {
            url: '127.0.0.1:8332',
            auth: 'futurebit',
            pass: settings.nodeRpcPassword || 'default_password',
            notify: true,
          },
        ],
        logdir: '/opt/apolloapi/backend/ckpool/logs',
        btcsig: fullBtcsig,
        zmqblock: 'tcp://127.0.0.1:28332',
        startdiff: settings.startdiff || 1024,
        mindiff: settings.mindiff || 1,
      };

      try {
        // Ensure the directory exists
        const dir = path.dirname(configCkpoolFilePath);
        await fsPromises.mkdir(dir, { recursive: true });

        // Write the configuration file
        await fsPromises.writeFile(
          configCkpoolFilePath,
          JSON.stringify(ckpoolConf, null, 2)
        );
        console.log('solo configuration saved successfully');
      } catch (writeErr) {
        console.log('Error writing solo configuration:', writeErr.message);
      }
    } catch (err) {
      console.log('Error in manageCkpoolConf:', err.message);
    }
  },

  // Manage Bitcoin configuration (api.conf and user.conf)
  // Note: bitcoin.conf is managed by node_start.sh and includes api.conf and user.conf
  async manageBitcoinConf(settings) {
    try {
      // Ensure settings is valid
      if (!settings) {
        console.log('No settings found for Bitcoin configuration');
        return;
      }

      // Copy the correct bitcoind binary based on node_software
      if (settings.nodeSoftware) {
        try {
          console.log(`Switching Bitcoin software to ${settings.nodeSoftware}...`);
          const switchResult = await this.switchBitcoinSoftware(settings.nodeSoftware);
          
          if (!switchResult.success) {
            console.log('Warning: Bitcoin software switch failed:', switchResult.message);
            // Continue with configuration management even if switch failed
          }
        } catch (switchErr) {
          console.log('Error during Bitcoin software switch:', switchErr.message);
          // Continue with configuration management even if switch failed
        }
      }

      // Create directories if they don't exist
      try {
        const configDir = path.dirname(configBitcoinApiConfPath);
        await fsPromises.mkdir(configDir, { recursive: true });
      } catch (dirErr) {
        console.log('Error creating directory:', dirErr.message);
      }

      // Setup ckpool configuration
      await this.manageCkpoolConf(settings);

      // Configure solo mining
      if (settings.nodeEnableSoloMining) {
        try {
          if (isProduction()) {
            await mockSystemctl('daemon-reload', '');
            await mockSystemctl('enable', 'ckpool');
            await mockSystemctl('restart', 'ckpool');
          } else {
            console.log('[DEV] Would setup solo mining with ckpool');
          }
        } catch (soloErr) {
          console.log('Error configuring solo mining:', soloErr.message);
        }
      } else {
        try {
          if (isProduction()) {
            await mockSystemctl('stop', 'ckpool');
            await mockSystemctl('disable', 'ckpool');
          } else {
            console.log('[DEV] Would disable ckpool');
          }
        } catch (disableErr) {
          console.log('Error disabling ckpool:', disableErr.message);
        }
      }

      // ===== BUILD api.conf =====
      // Contains: rpcpassword, Tor settings, maxconnections, LAN access settings
      // File is always created
      let apiConf = '# API managed Bitcoin configuration\n';

      // RPC password
      apiConf += `rpcpassword=${settings.nodeRpcPassword || 'default_password'}\n`;

      // Configure Tor
      if (settings.nodeEnableTor) {
        apiConf += `proxy=127.0.0.1:9050\n`;
        apiConf += `listen=1\n`;
        apiConf += `bind=127.0.0.1\n`;
        apiConf += `onlynet=onion\n`;
        apiConf += `dnsseed=0\n`;
        apiConf += `dns=0\n`;
        try {
          if (isProduction()) {
            await mockSystemctl('enable', 'tor');
            await mockSystemctl('restart', 'tor');
          } else {
            console.log('[DEV] Would enable and restart tor');
          }
        } catch (torErr) {
          console.log('Error configuring Tor:', torErr.message);
        }
      } else {
        try {
          if (isProduction()) {
            await mockSystemctl('stop', 'tor');
            await mockSystemctl('disable', 'tor');
          } else {
            console.log('[DEV] Would stop and disable tor');
          }
        } catch (torDisableErr) {
          console.log('Error disabling Tor:', torDisableErr.message);
        }
      }

      // Configure max connections
      if (settings.nodeMaxConnections) {
        apiConf += `maxconnections=${settings.nodeMaxConnections}\n`;
      }

      // Configure LAN access
      if (settings.nodeAllowLan) {
        apiConf += `rpcbind=0.0.0.0\n`;
        apiConf += `rpcallowip=0.0.0.0/0\n`;
      }

      // ===== BUILD user.conf =====
      // Contains: nodeUserConf (user custom configuration)
      // File is always created, even if empty (with default comment)
      let userConf = '# User custom Bitcoin configuration\n';

      if (settings.nodeUserConf) {
        const userConfLines = settings.nodeUserConf.split('\n');
        const formattedUserConf = [];

        // List of options managed by api.conf that should be excluded from user.conf
        const excludedOptions = [
          'rpcpassword',
          'rpcallowip',
          'rpcbind',
          'maxconnections',
          'proxy',
          'listen',
          'bind',
          'onlynet',
          'dnsseed',
          'dns'
        ];

        userConfLines.forEach((line) => {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine.startsWith('#')) {
            // Keep empty lines and comments
            formattedUserConf.push(trimmedLine);
          } else {
            const variable = trimmedLine.split('=')[0].trim();
            // Check if the variable is not in the excluded options
            if (!excludedOptions.includes(variable)) {
              formattedUserConf.push(trimmedLine);
            }
          }
        });

        const filteredConf = formattedUserConf.join('\n').trim();
        if (filteredConf) {
          userConf = filteredConf + '\n';
        }
      }

      // ===== CHECK AND WRITE api.conf =====
      let currentApiConf = '';
      try {
        currentApiConf = await fsPromises.readFile(configBitcoinApiConfPath, 'utf8');
      } catch (readErr) {
        console.log('api.conf does not exist, will create a new one');
      }

      if (currentApiConf !== apiConf) {
        console.log('Writing api.conf');
        try {
          await fsPromises.writeFile(configBitcoinApiConfPath, apiConf, 'utf8');
          console.log('api.conf saved successfully');
        } catch (writeErr) {
          console.log('Error writing api.conf:', writeErr.message);
        }
      } else {
        console.log('No changes to api.conf');
      }

      // ===== CHECK AND WRITE user.conf =====
      let currentUserConf = '';
      try {
        currentUserConf = await fsPromises.readFile(configBitcoinUserConfPath, 'utf8');
      } catch (readErr) {
        console.log('user.conf does not exist, will create a new one');
      }

      if (currentUserConf !== userConf) {
        console.log('Writing user.conf');
        try {
          await fsPromises.writeFile(configBitcoinUserConfPath, userConf, 'utf8');
          console.log('user.conf saved successfully');
        } catch (writeErr) {
          console.log('Error writing user.conf:', writeErr.message);
        }
      } else {
        console.log('No changes to user.conf');
      }

    } catch (err) {
      console.log('Error in manageBitcoinConf:', err.message);
    }
  },

  // Safely switch Bitcoin software
  async switchBitcoinSoftware(targetSoftware) {
    // Check initial service state
    let wasServiceRunning = false;
    let wasServiceEnabled = false;
    
    try {
      // Validate target software
      if (!['core-25.1', 'core-28.1', 'core-29.2', 'core-31.0', 'knots-29.2', 'knots-29.3'].includes(targetSoftware)) {
        throw new Error(`Invalid software: ${targetSoftware}. Valid options: core-25.1, core-28.1, core-29.2, core-31.0, knots-29.2, knots-29.3`);
      }

      console.log(`Switching Bitcoin software to ${targetSoftware}...`);

      if (!isProduction()) {
        console.log(`[DEV] Would switch to ${targetSoftware}`);
        return { success: true, message: `[DEV] Would switch to ${targetSoftware}` };
      }

      try {
        wasServiceRunning = await execWithSudo('systemctl is-active node') === 'active';
        wasServiceEnabled = await execWithSudo('systemctl is-enabled node') === 'enabled';
        console.log(`Initial service state - Running: ${wasServiceRunning}, Enabled: ${wasServiceEnabled}`);
      } catch (statusErr) {
        console.log('Could not check initial service status:', statusErr.message);
        // Set default values if we can't check status
        wasServiceRunning = false;
        wasServiceEnabled = false;
      }

      // Get architecture and paths first
      const arch = os.machine();
      const apolloDir = '/opt/apolloapi';
      const sourcePath = `${apolloDir}/backend/node/bin/${targetSoftware}/${arch}/bitcoind`;
      const destPath = `${apolloDir}/backend/node/bitcoind`;

      // Already on the target build? The binary is static per version, so
      // re-copying it costs ~30s of node downtime for nothing — and this runs on
      // every boot via manageBitcoinConf, delaying the API and forcing a browser
      // refresh. cmp exits 0 when identical: skip the whole switch then.
      try {
        await execWithSudo(`cmp -s "${sourcePath}" "${destPath}"`);
        console.log(`Bitcoin software already ${targetSoftware}, nothing to switch`);
        return { success: true, message: `Already on ${targetSoftware}` };
      } catch (_) {
        // Differ or dest missing → fall through and do the real switch.
      }

      // Stop node service if running
      if (wasServiceRunning) {
        try {
          console.log('Stopping node service...');
          await execWithSudo('systemctl stop node');
          
          // Wait for service to stop
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Check if service is actually stopped
          let maxRetries = 10;
          let retryCount = 0;
          let serviceStopped = false;
          
          while (retryCount < maxRetries && !serviceStopped) {
            try {
              const statusCheck = await execWithSudo('systemctl is-active node');
              if (statusCheck.trim() === 'active') {
                console.log(`Service still active, waiting... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                retryCount++;
              } else {
                serviceStopped = true;
                console.log('Node service stopped successfully');
              }
            } catch (statusCheckErr) {
              // If command fails, service is likely stopped
              serviceStopped = true;
              console.log('Node service appears to be stopped');
            }
          }
          
          // If service is still running, force kill
          if (!serviceStopped) {
            console.log('Warning: Node service is still running, forcing stop...');
            try {
              await execWithSudo('systemctl kill node');
              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (killErr) {
              console.log('Could not force kill service:', killErr.message);
            }
          }
          
          // Wait for bitcoind process to fully terminate and file to be available
          console.log('Waiting for bitcoind process to terminate...');
          maxRetries = 15;
          retryCount = 0;
          let fileAvailable = false;
          
          while (retryCount < maxRetries && !fileAvailable) {
            try {
              // Check if file is in use using fuser (more reliable than lsof)
              const fuserCheck = await execWithSudo(`fuser ${destPath} 2>/dev/null || true`);
              if (!fuserCheck.trim()) {
                // File is not in use, verify we can access it
                try {
                  await execWithSudo(`test -f ${destPath}`);
                  fileAvailable = true;
                  console.log('File is no longer in use and available');
                } catch (testErr) {
                  console.log(`File check failed, waiting... (attempt ${retryCount + 1}/${maxRetries})`);
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  retryCount++;
                }
              } else {
                console.log(`File still in use, waiting... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                retryCount++;
              }
            } catch (checkErr) {
              // If fuser fails, try a different approach - check if process exists
              try {
                const pgrepCheck = await execWithSudo(`pgrep -f "bitcoind.*datadir" || true`);
                if (!pgrepCheck.trim()) {
                  fileAvailable = true;
                  console.log('No bitcoind process found, file should be available');
                } else {
                  console.log(`Bitcoind process still running, waiting... (attempt ${retryCount + 1}/${maxRetries})`);
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  retryCount++;
                }
              } catch (pgrepErr) {
                // If all checks fail, assume file is available after a wait
                console.log('Could not verify file status, waiting before proceeding...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                fileAvailable = true;
              }
            }
          }
          
          if (!fileAvailable) {
            console.log('Warning: File may still be in use, but proceeding with copy attempt...');
          }
        } catch (stopErr) {
          console.log('Warning: Could not stop node service:', stopErr.message);
          // Don't throw error, just continue with the switch
          console.log('Continuing with software switch...');
        }
      } else {
        console.log('Node service was not running, no need to stop it');
      }

      // Check if source binary exists
      try {
        await execWithSudo(`test -f ${sourcePath}`);
      } catch (testErr) {
        throw new Error(`Source binary not found: ${sourcePath}`);
      }

      // Create backup of current binary
      try {
        await execWithSudo(`cp ${destPath} ${destPath}.backup`);
        console.log('Created backup of current bitcoind binary');
      } catch (backupErr) {
        console.log('Could not create backup:', backupErr.message);
      }

      // Copy new binary
      try {
        await execWithSudo(`cp ${sourcePath} ${destPath}`);
        await execWithSudo(`chmod +x ${destPath}`);
        console.log(`Copied ${sourcePath} to ${destPath}`);
      } catch (copyErr) {
        console.log('Error copying binary:', copyErr.message);
        
        // Try to restore backup if copy failed
        try {
          await execWithSudo(`cp ${destPath}.backup ${destPath}`);
          console.log('Restored backup binary after copy failure');
        } catch (restoreErr) {
          console.log('Could not restore backup:', restoreErr.message);
        }
        throw new Error(`Failed to copy binary: ${copyErr.message}`);
      }

      // Start node service only if it was running initially
      if (wasServiceRunning && wasServiceEnabled) {
        try {
          console.log('Starting node service (was running initially)...');
          await execWithSudo('systemctl start node');
          
          // Wait and check if service started successfully
          await new Promise(resolve => setTimeout(resolve, 3000));
          const statusCheck = await execWithSudo('systemctl is-active node');
          if (statusCheck === 'active') {
            console.log('Node service started successfully');
          } else {
            console.log('Warning: Node service may not have started properly');
            console.log('Check logs with: journalctl -u node.service');
          }
        } catch (startErr) {
          console.log('Warning: Could not start node service:', startErr.message);
          console.log('You may need to start it manually with: systemctl start node');
        }
      } else if (wasServiceEnabled && !wasServiceRunning) {
        console.log('Node service is enabled but was not running initially, not starting it');
      } else {
        console.log('Node service is not enabled, not starting it');
      }

      console.log(`Successfully switched to ${targetSoftware}`);
      return { success: true, message: `Successfully switched to ${targetSoftware}` };

    } catch (err) {
      console.log('Error in switchBitcoinSoftware:', err.message);
      
      // Try to start the service if something went wrong and it was running initially
      if (isProduction() && wasServiceRunning && wasServiceEnabled) {
        try {
          console.log('Attempting to start node service after error (was running initially)...');
          await execWithSudo('systemctl start node');
        } catch (recoveryErr) {
          console.log('Could not start node service in recovery:', recoveryErr.message);
        }
      }
      
      return { success: false, message: err.message };
    }
  },
};