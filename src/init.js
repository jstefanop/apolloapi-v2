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
  } else {
    const envFile = readFileSync(envPath)
    let envString = envFile.toString();
    if (!envString.match(/BITCOIND_PASSWORD=.*/)) {
      console.log('Generating Bitcoin RPC password')

      const rpcPassword = generator.generate({
        length: 12,
        numbers: true
      })

      await knex('settings').update({
        node_rpc_password: rpcPassword
      })

      await utils.auth.changeNodeRpcPassword(rpcPassword)
    }
  }
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
