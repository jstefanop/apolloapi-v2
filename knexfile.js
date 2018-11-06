const config = require('config')

module.exports = {
  client: 'sqlite',
  connection: config.get('db.url')
}
