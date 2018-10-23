const { writeFileSync, existsSync } = require('fs')
const { join } = require('path')
const crypto = require('crypto')

initEnvFile()
runMigrations()
.then(startServer)

function initEnvFile () {
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
}

async function runMigrations () {
  const { knex } = require('./db')
  await knex.migrate.latest()
}

function startServer () {
  require('./server')
}
