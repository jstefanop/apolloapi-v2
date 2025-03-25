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
const configBitcoinFilePath = path.resolve(
  __dirname,
  '../backend/node/bitcoin.conf'
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
        // Check if files exist before trying to modify them
        await fsPromises.access(configBitcoinFilePath);
        await fsPromises.access(configCkpoolFilePath);

        // Update Bitcoin configuration file
        await execWithSudo(
          `sed -i 's/rpcpassword.*/rpcpassword=${password}/g' ${configBitcoinFilePath}`
        );

        // Update ckpool configuration file
        await execWithSudo(
          `sed -i 's#"pass":.*#"pass": "${password}",#g' ${configCkpoolFilePath}`
        );

        // Restart the node service
        await mockSystemctl('restart', 'node');

        // Restart ckpool if solo mining is enabled
        if (settings?.nodeEnableSoloMining) {
          await mockSystemctl('restart', 'ckpool');
        }
      } catch (err) {
        console.log('Error updating configuration files:', err.message);

        // Try to create the files if they don't exist
        try {
          // Create directories if needed
          const bitcoinDir = path.dirname(configBitcoinFilePath);
          const ckpoolDir = path.dirname(configCkpoolFilePath);

          await fsPromises.mkdir(bitcoinDir, { recursive: true });
          await fsPromises.mkdir(ckpoolDir, { recursive: true });

          // Create basic configuration files
          const bitcoinConfig = `server=1\nrpcuser=futurebit\nrpcpassword=${password}\ndaemon=0\nupnp=1\nuacomment=FutureBit-Apollo-Node`;
          await fsPromises.writeFile(configBitcoinFilePath, bitcoinConfig);

          const ckpoolConfig = `{\n  "btcd": [\n    {\n      "url": "127.0.0.1:8332",\n      "auth": "futurebit",\n      "pass": "${password}",\n      "notify": true\n    }\n  ]\n}`;
          await fsPromises.writeFile(configCkpoolFilePath, ckpoolConfig);

          console.log('Created configuration files successfully');
        } catch (createErr) {
          console.log('Error creating configuration files:', createErr.message);
        }
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
        console.log('No settings found for ckpool configuration');
        return;
      }

      // Create ckpool configuration
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
        btcsig: settings.btcsig || '/mined by Solo FutureBit Apollo/',
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
        console.log('ckpool configuration saved successfully');
      } catch (writeErr) {
        console.log('Error writing ckpool configuration:', writeErr.message);
      }
    } catch (err) {
      console.log('Error in manageCkpoolConf:', err.message);
    }
  },

  // Manage Bitcoin configuration
  async manageBitcoinConf(settings) {
    try {
      // Ensure settings is valid
      if (!settings) {
        console.log('No settings found for Bitcoin configuration');
        return;
      }

      // Create directories if they don't exist
      try {
        const configDir = path.dirname(configBitcoinFilePath);
        await fsPromises.mkdir(configDir, { recursive: true });
      } catch (dirErr) {
        console.log('Error creating directory:', dirErr.message);
      }

      // Check current configuration file if it exists
      let currentConf = '';
      let currentConfBase64 = '';

      try {
        currentConf = await fsPromises.readFile(configBitcoinFilePath, 'utf8');
        currentConfBase64 = Buffer.from(currentConf).toString('base64');
      } catch (readErr) {
        console.log('Bitcoin configuration file does not exist, will create a new one');
      }

      // Build new configuration
      const defaultConf = `server=1\nrpcuser=futurebit\nrpcpassword=${settings.nodeRpcPassword || 'default_password'}\ndaemon=0\nupnp=1\nuacomment=FutureBit-Apollo-Node`;
      let conf = defaultConf;
      conf += `\n#SOLO_START\nzmqpubhashblock=tcp://127.0.0.1:28332\n#SOLO_END`;

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

      // Configure Tor
      if (settings.nodeEnableTor) {
        conf += `\n#TOR_START\nproxy=127.0.0.1:9050\nlisten=1\nbind=127.0.0.1\nonlynet=onion\ndnsseed=0\ndns=0\n#TOR_END`;
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
      if (settings.nodeMaxConnections)
        conf += `\nmaxconnections=${settings.nodeMaxConnections}`;
      else
        conf += '\nmaxconnections=64';

      // Configure LAN access
      if (settings.nodeAllowLan) {
        const lanNetwork = this.getSystemNetwork();
        conf += `\nrpcbind=0.0.0.0\nrpcallowip=0.0.0.0/0`;
      }

      // Add user configuration if present
      if (settings.nodeUserConf) {
        const userConfLines = settings.nodeUserConf.split('\n');
        const formattedUserConf = [];

        // List of options to exclude
        const excludedOptions = ['rpcallowip', 'rpcbind', 'maxconnections'];

        userConfLines.forEach((line) => {
          const variable = line.split('=')[0].trim();

          // Check if the variable is not in the excluded options and not in default conf
          if (!defaultConf.includes(variable) && !excludedOptions.includes(variable)) {
            formattedUserConf.push(line.trim());
          }
        });

        if (formattedUserConf.length) {
          const filteredUserConf = formattedUserConf.join('\n');
          conf += `\n#USER_INPUT_START\n${filteredUserConf}\n#USER_INPUT_END`;
        }
      }

      // Ensure there are no trailing characters or spaces
      conf = conf.trim() + '\n';

      // Convert to base64 to check if there are changes
      const confBase64 = Buffer.from(conf).toString('base64');

      // Only write the file if there are changes
      if (currentConfBase64 === confBase64) {
        console.log('No changes to bitcoin.conf file');
        return;
      }

      console.log('Writing Bitcoin conf file');

      try {
        // Write the configuration file
        await fsPromises.writeFile(configBitcoinFilePath, conf, 'utf8');
        console.log('Bitcoin configuration saved successfully');

        // Restart the node service
        if (isProduction()) {
          await execWithSudo('sleep 3 && systemctl restart node');
        } else {
          console.log('[DEV] Would restart node service after 3 seconds');
        }
      } catch (writeErr) {
        console.log('Error writing Bitcoin configuration:', writeErr.message);
      }
    } catch (err) {
      console.log('Error in manageBitcoinConf:', err.message);
    }
  },
};