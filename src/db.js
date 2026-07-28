const config = require('config');
const _knex = require('knex');

const knex = _knex({
  client: 'sqlite3',
  connection: config.get('db.url'),
  useNullAsDefault: true,
  // Keep query values out of error messages. By default knex prepends the
  // interpolated SQL — bindings included — to err.message, so a failed insert
  // into `setup` carries the bcrypt password hash inside the message itself.
  // That message is logged to a journal this release makes persistent on the
  // eMMC, and is handed back to the caller by the GraphQL error path.
  compileSqlOnError: false,
  // debug: process.env.NODE_ENV === 'development',
});

module.exports.knex = knex;
