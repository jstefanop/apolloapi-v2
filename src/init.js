const { writeFileSync, readFileSync, existsSync } = require('fs');
const { join } = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
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
    await knex.migrate.latest();
    const [settings] = await knex('settings')
      .select(['node_rpc_password as nodeRpcPassword'])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1);
    await utils.auth.manageBitcoinConf(settings);
    await runGenerateBitcoinPassword(settings);
  } catch (err) {
    console.log(err);
  }
};

const runGenerateBitcoinPassword = async (settings) => {
  try {
    console.log('Checking bitcoin password existence');

    if (settings && settings.nodeRpcPassword)
      return console.log('Bitcoin password found');
    else await utils.auth.changeNodeRpcPassword(settings);
  } catch (err) {
    console.log(err);
  }
};

initEnvFile();
runMigrations().then(startServer);

function startServer() {
  require('./server');
}
