exports.up = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.text('node_enable_solo_mining').defaultTo(null);
  });
};

exports.down = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.dropColumn('node_enable_solo_mining');
  });
};