import dotenv from 'dotenv';
import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import * as utils from './utils.js';
import { knex } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const initEnvFile = async () => {
  const envPath = join(__dirname, '..', '.env');
  const envExists = existsSync(envPath);
  if (!envExists) {
    const configVars = [
      {
        name: 'DATABASE_URL',
        value: join(__dirname, '..', 'futurebit.sqlite'),
      },
      {
        name: 'APP_SECRET',
        value: crypto.randomBytes(64).toString('hex'),
      },
    ];
    const envFile = configVars.map(({ name, value }) => `${name}=${value}`).join('\n') + '\n';
    writeFileSync(envPath, envFile);
  }
};

const runMigrations = async () => {
  try {
    console.log('Run migrations');
    await knex.migrate.latest();
    const [settings] = await knex('settings')
      .select([
        'node_rpc_password as nodeRpcPassword',
        'node_enable_tor as nodeEnableTor',
        'node_user_conf as nodeUserConf',
        'node_enable_solo_mining as nodeEnableSoloMining',
        'node_max_connections as nodeMaxConnections',
        'node_allow_lan as nodeAllowLan',
        'btcsig',
      ])
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

    if (settings && settings.nodeRpcPassword) {
      console.log('Bitcoin password found');
    } else {
      await utils.auth.changeNodeRpcPassword(settings);
    }
  } catch (err) {
    console.log(err);
  }
};

initEnvFile();
runMigrations().then(startServer);

function startServer() {
  import('./server.js');
}
