const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');
const generator = require('generate-password');
const config = require('config');
const { knex } = require('./db');
const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');
const util = require('util');

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

const configCkpoolServiceFilePath = path.resolve(
  __dirname,
  '../backend/systemd/ckpool.service'
);

// Helper function to execute commands with sudo only in production
const execWithSudo = async (command) => {
  try {
    const cmdToRun = isProduction()
      ? `sudo ${command}`
      : command;

    console.log(`Executing command: ${cmdToRun}`);
    const { stdout, stderr } = await execPromise(cmdToRun);

    if (stderr) {
      console.error(`Command stderr: ${stderr}`);
    }

    return stdout.trim();
  } catch (error) {
    if (!isProduction()) {
      console.log(`Command would fail in production: ${error.message}`);
      return "dev-mode-success";
    }
    throw error;
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

  // Change the system user password
  async changeSystemPassword(password) {
    if (isProduction()) {
      await execWithSudo(`echo 'futurebit:${password}' | chpasswd`);
    } else {
      console.log(`[DEV] Would change system password for user 'futurebit' to: ${password}`);
    }
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

      // Update the password in the database
      await knex('settings').update({
        node_rpc_password: password,
      });

      try {
        // Create directories if needed
        const bitcoinDir = path.dirname(configBitcoinApiConfPath);
        const ckpoolDir = path.dirname(configCkpoolFilePath);

        await fsPromises.mkdir(bitcoinDir, { recursive: true });
        await fsPromises.mkdir(ckpoolDir, { recursive: true });

        // Update api.conf with new password (sed will replace existing or we'll rebuild it)
        try {
          await fsPromises.access(configBitcoinApiConfPath);
          // File exists, update the password line
          await execWithSudo(
            `sed -i 's/rpcpassword.*/rpcpassword=${password}/g' ${configBitcoinApiConfPath}`
          );
        } catch (accessErr) {
          // api.conf doesn't exist, create it with just the password
          await fsPromises.writeFile(configBitcoinApiConfPath, `rpcpassword=${password}\n`);
          console.log('Created api.conf with new password');
        }

        // Update ckpool configuration file
        try {
          await fsPromises.access(configCkpoolFilePath);
          await execWithSudo(
            `sed -i 's#"pass":.*#"pass": "${password}",#g' ${configCkpoolFilePath}`
          );
        } catch (ckpoolErr) {
          // ckpool.conf doesn't exist, create basic one
          const ckpoolConfig = `{\n  "btcd": [\n    {\n      "url": "127.0.0.1:8332",\n      "auth": "futurebit",\n      "pass": "${password}",\n      "notify": true\n    }\n  ]\n}`;
          await fsPromises.writeFile(configCkpoolFilePath, ckpoolConfig);
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
            await execWithSudo(`cp ${configCkpoolServiceFilePath} /etc/systemd/system/ckpool.service`);
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
      if (!['core-25.1', 'core-28.1', 'knots-29.2'].includes(targetSoftware)) {
        throw new Error(`Invalid software: ${targetSoftware}. Valid options: core-25.1, core-28.1, knots-29.2`);
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