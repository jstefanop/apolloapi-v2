exports.up = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.integer('node_max_connections').defaultTo(64);
    t.boolean('node_allow_lan').defaultTo(false);
  });
};

exports.down = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.dropColumn('node_max_connections');
    t.dropColumn('node_allow_lan');
  });
};