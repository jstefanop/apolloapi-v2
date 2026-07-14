const dotenv = require('dotenv')
const { join } = require('path')

dotenv.config({ silent: true })

module.exports = {
  db: {
    // Honor DATABASE_URL (used by tests/E2E to point at a throwaway DB);
    // default to the repo/device sqlite when unset.
    url: process.env.DATABASE_URL || join(__dirname, '..', 'futurebit.sqlite')
  },
  settings: {
  },
  server: {
    secret: process.env.APP_SECRET,
    port: process.env.PORT || 5000
  }
}
