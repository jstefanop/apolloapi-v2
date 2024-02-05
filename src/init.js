const { writeFileSync, readFileSync, existsSync } = require('fs');
const { join } = require('path');
const crypto = require('crypto');
const generator = require('generate-password');
const utils = require('./utils');
const { knex } = require('./db');
const fs = require('fs').promises;
const path = require('path');

const initEnvFile = async () => {
  const envPath = join(__dirname, '..', '.env');
  const envExists = existsSync(envPath);
  if (!envExists) {
    const configVars = [];
    configVars.push({
      name: 'DATABASE_URL',
      value: join(__dirname, '..', 'futurebit.sqlite'),
    });
    configVars.push({
      name: 'APP_SECRET',
      value: crypto.randomBytes(64).toString('hex'),
    });
    const envFile =
      configVars.map(({ name, value }) => `${name}=${value}`).join('\n') + '\n';
    writeFileSync(envPath, envFile);
  }
};

const runMigrations = async () => {
  try {
    console.log('Run migrations');
    const resp = await knex.migrate.latest();
    await createBitcoinConfigFile();
    await runGenerateBitcoinPassword();
  } catch (err) {
    console.log(err);
  }
};

const runGenerateBitcoinPassword = async () => {
  try {
    console.log('Checking bitcoin password existence');
    const [settings] = await knex('settings')
      .select(['node_rpc_password as nodeRpcPassword'])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1);

    if (settings && settings.nodeRpcPassword)
      return console.log('Bitcoin password found');
    else await utils.auth.changeNodeRpcPassword();
  } catch (err) {
    console.log(err);
  }
};

const createCkpoolConfigFile = async () => {
  const configFilePath = path.resolve(
    __dirname,
    '../backend/ckpool/ckpool.conf'
  );
  const configContent = `{
  "btcd": [
    {
      "url": "127.0.0.1:8332",
      "auth": "futurebit",
      "pass": "",
      "notify": true
    }
  ],
  "logdir": "/opt/apolloapi/backend/ckpool/logs"
}`;

  try {
    // Check if the file exists
    await fs.access(configFilePath);
    console.log('File ckpool.conf already exists.');
  } catch (error) {
    try {
      // Create the file
      await fs.writeFile(configFilePath, configContent, 'utf-8');
      console.log('File ckpool.conf created.');
    } catch (error) {
      console.error(
        `Error during the creation of the file ckpool.conf: ${error.message}`
      );
    }
  }
};

const createBitcoinConfigFile = async () => {
  const configFilePath = path.resolve(
    __dirname,
    '../backend/node/bitcoin.conf'
  );
  const configContent = `server=1
rpcuser=futurebit
rpcpassword=
daemon=0
maxconnections=32
upnp=1
uacomment=FutureBit-Apollo-Node`;

  try {
    // Check if the file exists
    await fs.access(configFilePath);
    console.log('File bitcoin.conf already exists.');
  } catch (error) {
    try {
      // Create the file
      await fs.writeFile(configFilePath, configContent, 'utf-8');
      console.log('File bitcoin.conf created.');
      await utils.auth.changeNodeRpcPassword();
    } catch (error) {
      console.error(
        `Error during the creation of the file bitcoin.conf: ${error.message}`
      );
    }
  }
};

initEnvFile();
runMigrations().then(createCkpoolConfigFile).then(startServer);

function startServer() {
  require('./server');
}
