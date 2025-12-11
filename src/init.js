const { writeFileSync, existsSync } = require('fs');
const { join } = require('path');
const crypto = require('crypto');
const utils = require('./utils');
const { knex } = require('./db');

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
      .select([
        'node_rpc_password as nodeRpcPassword',
        'node_enable_tor as nodeEnableTor',
        'node_user_conf as nodeUserConf',
        'node_enable_solo_mining as nodeEnableSoloMining',
        'node_max_connections as nodeMaxConnections',
        'node_allow_lan as nodeAllowLan',
        'btcsig',
        'node_software as nodeSoftware'
      ])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1);
    await utils.auth.manageBitcoinConf(settings);
    await runGenerateBitcoinPassword(settings);
  } catch (err) {
    console.log('Error in runMigrations:', err);
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

// Funzione principale di avvio
async function initializeApp() {
  await initEnvFile();
  await runMigrations();
  return require('./server');
}

// Avvia l'applicazione e gestisci eventuali errori
initializeApp().catch(error => {
  console.error('Failed to initialize app:', error);
  process.exit(1);
});