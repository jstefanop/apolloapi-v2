const { writeFileSync, readFileSync, existsSync } = require('fs')
const { join } = require('path')
const crypto = require('crypto')
const generator = require('generate-password')
const utils = require('./utils')
const { knex } = require('./db')

initEnvFile()
runMigrations()
.then(startServer)

async function initEnvFile () {
  const envPath = join(__dirname, '..', '.env')
  const envExists = existsSync(envPath)
  if (!envExists) {
    const configVars = []
    configVars.push({
      name: 'DATABASE_URL',
      value: join(__dirname, '..', 'futurebit.sqlite')
    })
    configVars.push({
      name: 'APP_SECRET',
      value: crypto.randomBytes(64).toString('hex')
    })
    const envFile = configVars
      .map(({ name, value }) => `${name}=${value}`)
      .join('\n') + '\n'
    writeFileSync(envPath, envFile)
  }
  
  const [ settings ] = await knex('settings').select(['node_rpc_password as nodeRpcPassword'])

  if (settings && settings.nodeRpcPassword) return
  else await utils.auth.changeNodeRpcPassword()
}

async function runMigrations () {
  try {
    const resp = await knex.migrate.latest()
  } catch (err) {
    console.log(err)
  }
}

function startServer () {
  require('./server')
}
