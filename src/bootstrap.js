const path = require('path');
const { ensureEnvFile } = require('./env');
const { ensureDbLocation, ensureMinerRuntimeDir } = require('./paths');
const { applyNodeConfiguration } = require('./node/configManager');
const { ensureRpcCredentials } = require('./node/credentials');

const APP_ROOT = path.join(__dirname, '..');

async function bootstrap({ knex: providedKnex, stateDir } = {}) {
  if (!providedKnex) process.chdir(APP_ROOT);
  ensureEnvFile();

  const knex = providedKnex || require('./db').knex;
  console.log('[bootstrap] Running database migrations');
  await knex.migrate.latest({
    directory: path.join(APP_ROOT, 'migrations'),
  });

  const settings = await knex('settings')
    .select([
      'node_enable_tor',
      'node_user_conf',
      'node_enable_solo_mining',
      'node_max_connections',
      'node_allow_lan',
      'btcsig',
      'startdiff',
      'mindiff',
      'node_software',
    ])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .first();

  if (!settings) {
    throw new Error('Bootstrap could not find the default settings row');
  }

  const credentials = await ensureRpcCredentials(knex, { stateDir });
  const result = await applyNodeConfiguration({
    knex,
    settings,
    stateDir,
    credentials,
  });

  console.log(
    `[bootstrap] Runtime configuration ready (${result.changed.length} file(s) updated)`
  );
  return result;
}

async function runCli() {
  let knex;
  try {
    process.chdir(APP_ROOT);
    ensureEnvFile();
    ensureDbLocation(); // relocate the DB out of the checkout before ./db is required
    ensureMinerRuntimeDir(); // relocate miner runtime files; create the dir before the miner starts
    knex = require('./db').knex;
    await bootstrap({ knex });
  } catch (error) {
    console.error('[bootstrap] Failed:', error);
    process.exitCode = 1;
  } finally {
    if (knex) await knex.destroy();
  }
}

if (require.main === module) {
  runCli();
}

module.exports = { bootstrap };
