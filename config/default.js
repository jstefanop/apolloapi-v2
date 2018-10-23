const dotenv = require('dotenv')
const { join } = require('path')

dotenv.config({ silent: true })

module.exports = {
  db: {
    url: join(__dirname, '..', 'futurebit.sqlite')
  },
  settings: {
  },
  server: {
    secret: process.env.APP_SECRET,
    port: process.env.PORT || 5000
  }
}
