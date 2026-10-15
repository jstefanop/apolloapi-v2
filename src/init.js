// Before anything that requires `config` (./utils and ./db do): see ./env.js.
const { ensureEnvFile } = require('./env');
ensureEnvFile();

const utils = require('./utils');
const { knex } = require('./db');

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
        'startdiff',
        'mindiff',
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

async function initializeApp() {
  await runMigrations();
  return require('./server');
}

// Avvia l'applicazione e gestisci eventuali errori
initializeApp().catch(error => {
  console.error('Failed to initialize app:', error);
  process.exit(1);
});