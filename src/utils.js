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

  getSystemNetwork() {
    // Get network interface information
    const interfaces = os.networkInterfaces();
    let network = null;

    console.log(interfaces);

    // Check if wlan0 has an associated IP address
    if (interfaces['wlan0'] && interfaces['wlan0'].some(info => info.family === 'IPv4')) {
      // If wlan0 has an associated IP address, use wlan0
      network = interfaces['wlan0'].find(info => info.family === 'IPv4').address;
    } else if (interfaces['eth0'] && interfaces['eth0'].some(info => info.family === 'IPv4')) {
      // If wlan0 doesn't have an associated IP address but eth0 does, use eth0
      network = interfaces['eth0'].find(info => info.family === 'IPv4').address;
    } else {
      console.log('No IP address associated with wlan0 or eth0');
    }

    console.log('LAN IP Address:', network);

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
      const defaultConf = `server=1\nrpcuser=futurebit\nrpcpassword=${settings.nodeRpcPassword}\ndaemon=0\nupnp=1\nuacomment=FutureBit-Apollo-Node`;
      let conf = defaultConf;

      this.manageCkpoolConf(settings);

      if (settings.nodeEnableSoloMining) {
        conf += `\n#SOLO_START\nzmqpubhashblock=tcp://127.0.0.1:28332\n#SOLO_END`;

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
        conf += `\nrpcallowip=${lanNetwork || '127.0.0.1'}`;
      }

      if (settings.nodeUserConf) {
        // Split settings.nodeUserConf and defaultConf into arrays of lines
        const userConfLines = settings.nodeUserConf.split('\n');
        const defaultConfLines = defaultConf.split('\n');

        // Exclude lines from settings.nodeUserConf that are also present in defaultConf
        const filteredUserConfLines = userConfLines.filter(line => !defaultConfLines.includes(line));

        // Join the remaining lines back into a single string
        const filteredUserConf = filteredUserConfLines.join('\n');

        // Append the filtered user configuration to the overall configuration
        conf += `\n#USER_INPUT_START\n${filteredUserConf}\n#USER_INPUT_END`;
      }

      console.log('Writing Bitcoin conf file', conf);

      await fsPromises.writeFile(configBitcoinFilePath, conf);

      exec('sudo systemctl restart node');
    } catch (err) {
      console.log('ERR manageBitcoinConf', err);
    }
  },
};
