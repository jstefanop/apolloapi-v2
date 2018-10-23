const config = require('config')

module.exports = {
  client: 'pg',
  connection: config.get('db.url')
}
