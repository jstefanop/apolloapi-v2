const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');
const generator = require('generate-password');
const config = require('config');
const { knex } = require('./db');
const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');

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

module.exports.auth = {
  hashPassword(password) {
    return bcrypt.hash(password, 12);
  },

  comparePassword(password, hash) {
    if (!password || !hash) {
      return false;
    }
    return bcrypt.compare(password, hash);
  },

  changeSystemPassword(password) {
    exec(`echo 'futurebit:${password}' | sudo chpasswd`);
  },

  async changeNodeRpcPassword(settings) {
    try {
      console.log('Generating and saving bitcoin password');

      const password = generator.generate({
        length: 12,
        numbers: true,
      });

      await knex('settings').update({
        node_rpc_password: password,
      });

      await fsPromises.access(configBitcoinFilePath);
      await fsPromises.access(configCkpoolFilePath);

      exec(
        `sudo sed -i 's/rpcpassword.*/rpcpassword=${password}/g' ${configBitcoinFilePath}`
      );

      exec(
        `sudo sed -i 's#"pass":.*#"pass": "${password}",#g' ${configCkpoolFilePath}`
      );

      exec('sudo systemctl restart node');

      if (settings?.nodeEnableSoloMining) exec('sudo systemctl restart ckpool');
    } catch (err) {
      console.log('ERR changeNodeRpcPassword', err);
    }
  },

  generateAccessToken() {
    const accessToken = jwt.sign({}, config.get('server.secret'), {
      subject: 'apollouser',
      audience: 'auth',
    });
    return {
      accessToken,
    };
  },

  networkAddressWithCIDR(ipAddress, netmask) {
    // Converti l'indirizzo IP e la netmask in forma binaria
    const ipBinary = ipAddress
      .split('.')
      .map((part) => parseInt(part, 10).toString(2).padStart(8, '0'))
      .join('');
    const netmaskBinary = netmask
      .split('.')
      .map((part) => parseInt(part, 10).toString(2).padStart(8, '0'))
      .join('');

    // Applica l'operazione bitwise AND
    const networkBinary = ipBinary
      .split('')
      .map((bit, index) => bit & netmaskBinary[index])
      .join('');

    // Converti il risultato in forma di stringa
    const networkAddress = networkBinary
      .match(/.{1,8}/g)
      .map((byte) => parseInt(byte, 2))
      .join('.');

    // Calcola il numero di bit della netmask
    const cidrPrefix = netmask
      .split('.')
      .reduce(
        (acc, byte) =>
          acc + (parseInt(byte, 10).toString(2).match(/1/g) || '').length,
        0
      );

    return `${networkAddress}/${cidrPrefix}`;
  },

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
    } else {
      console.log('No IP address associated with wlan0 or eth0');
    }

    if (address && netmask)
      network = this.networkAddressWithCIDR(address, netmask);

    return network;
  },

  async manageCkpoolConf(settings) {
    try {
      const ckpoolConf = {
        btcd: [
          {
            url: '127.0.0.1:8332',
            auth: 'futurebit',
            pass: settings.nodeRpcPassword,
            notify: true,
          },
        ],
        logdir: '/opt/apolloapi/backend/ckpool/logs',
        btcsig: '/mined by Solo FutureBit Apollo/',
        zmqblock: 'tcp://127.0.0.1:28332',
      };

      await fsPromises.writeFile(
        configCkpoolFilePath,
        JSON.stringify(ckpoolConf, null, 2)
      );
    } catch (err) {
      console.log('ERR manageCkpoolConf', err);
    }
  },

  async manageBitcoinConf(settings) {
    try {
      // Checking current conf file
      const currentConf = await fsPromises.readFile(
        configBitcoinFilePath,
        'utf8'
      );
      const currentConfBase64 = Buffer.from(currentConf).toString('base64');

      const defaultConf = `server=1\nrpcuser=futurebit\nrpcpassword=${settings.nodeRpcPassword}\ndaemon=0\nupnp=1\nuacomment=FutureBit-Apollo-Node`;
      let conf = defaultConf;
      conf += `\n#SOLO_START\nzmqpubhashblock=tcp://127.0.0.1:28332\n#SOLO_END`;

      this.manageCkpoolConf(settings);

      if (settings.nodeEnableSoloMining) {
        exec(
          `sudo cp ${configCkpoolServiceFilePath} /etc/systemd/system/ckpool.service`
        );
        exec('sudo systemctl daemon-reload');
        exec('sudo systemctl enable ckpool');
        exec('sudo systemctl restart ckpool');
      } else {
        exec('sudo systemctl stop ckpool');
        exec('sudo systemctl disable ckpool');
      }

      if (settings.nodeEnableTor) {
        conf += `\n#TOR_START\nproxy=127.0.0.1:9050\nlisten=1\nbind=127.0.0.1\nonlynet=onion\ndnsseed=0\ndns=0\n#TOR_END`;
        exec('sudo systemctl enable tor');
        exec('sudo systemctl restart tor');
      } else {
        exec('sudo systemctl stop tor');
        exec('sudo systemctl disable tor');
      }

      if (settings.nodeMaxConnections)
        conf += `\nmaxconnections=${settings.nodeMaxConnections}`;
      else conf += '\nmaxconnections=32';

      if (settings.nodeAllowLan) {
        const lanNetwork = this.getSystemNetwork();
        conf += `\nrpcbind=0.0.0.0\nrpcallowip=0.0.0.0/0`;
      }

      if (settings.nodeUserConf) {
        // Extract lines from settings.nodeUserConf
        const userConfLines = settings.nodeUserConf.split('\n');

        // Initialize an empty array to store formatted user configurations
        const formattedUserConf = [];

        // Iterate through each line and add to formattedUserConf if not in defaultConf
        userConfLines.forEach((line) => {
          const variable = line.split('=')[0];
          if (!defaultConf.includes(variable)) {
            formattedUserConf.push(line.trim());
          }
        });

        if (formattedUserConf.length) {
          // Join the formatted variables into a single string with newlines
          const filteredUserConf = formattedUserConf.join('\n');

          // Append the filtered user configuration to the overall configuration
          conf += `\n#USER_INPUT_START\n${filteredUserConf}\n#USER_INPUT_END`;
        }
      }

      // Ensure there are no trailing characters or spaces
      conf = conf.trim() + '\n';

      const confBase64 = Buffer.from(conf).toString('base64');

      if (currentConfBase64 === confBase64)
        return console.log('No changes to bitcoin.conf file');

      console.log('Writing Bitcoin conf file', conf);

      await fsPromises.writeFile(configBitcoinFilePath, conf, 'utf8');

      exec('sleep 3 && sudo systemctl restart node');
    } catch (err) {
      console.log('ERR manageBitcoinConf', err);
    }
  },
};
