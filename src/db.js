const config = require('config');
const _knex = require('knex');

const knex = _knex({
  client: 'sqlite3',
  connection: config.get('db.url'),
  useNullAsDefault: true,
});

module.exports.knex = knex;
