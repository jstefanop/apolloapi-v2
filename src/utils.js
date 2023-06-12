const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');
const generator = require('generate-password');
const config = require('config');
const { knex } = require('./db');
const fsPromises = require('fs').promises;

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

  async changeNodeRpcPassword() {
    try {
      console.log('Generating and saving bitcoin password');

      const password = generator.generate({
        length: 12,
        numbers: true,
      });

      await knex('settings').update({
        node_rpc_password: password,
      });

      exec(
        `sudo sed -i s/rpcpassword.*/rpcpassword=${password}/g /opt/apolloapi/backend/node/bitcoin.conf`
      );
      exec('sudo systemctl restart node');
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

  async manageBitcoinConf(settings) {
    const defaultConf = `server=1\nrpcuser=futurebit\nrpcpassword=${settings.nodeRpcPassword}\ndaemon=0\nmaxconnections=32\nupnp=1\nuacomment=FutureBit-Apollo-Node`;
    let conf = defaultConf;

    if (settings.nodeEnableSoloMining) {
      conf += `\n#SOLO_START\nzmqpubhashblock=tcp://127.0.0.1:28332\n#SOLO_END`;

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
      };

      await fsPromises.writeFile('/opt/apolloapi/backend/ckpool/ckpool.conf', JSON.stringify(ckpoolConf, null, 2));

      exec(
        ' sudo cp /opt/app/backend/systemd/ckpool.service /etc/systemd/system/ckpool.service'
      );
      exec('sudo systemctl daemon-reload');
      exec('sudo systemctl enable ckpool');
      exec('sudo systemctl restart ckpool');
    }

    if (settings.nodeEnableTor)
      conf += `\n#TOR_START\nproxy=127.0.0.1:9050\nlisten=1\nbind=127.0.0.1\nonlynet=onion\ndnsseed=0\ndns=0\n#TOR_END`;

    if (settings.nodeUserConf)
      conf += `\n#USER_INPUT_START\n${settings.nodeUserConf}\n#USER_INPUT_END`;

    console.log('Writing Bitcoin conf file', conf);

    exec(`echo "${conf}" | sudo tee /opt/apolloapi/backend/node/bitcoin.conf`);

    exec('sudo systemctl restart node');
  },
};
