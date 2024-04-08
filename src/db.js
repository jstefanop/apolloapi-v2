const config = require('config');
const _knex = require('knex');

const knex = _knex({
  client: 'sqlite3',
  connection: config.get('db.url'),
  useNullAsDefault: true,
  debug: process.env.NODE_ENV === 'development',
});

module.exports.knex = knex;
