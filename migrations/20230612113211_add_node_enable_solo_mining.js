exports.up = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.boolean('node_enable_solo_mining').notNull().defaultTo(false);
  });
};

exports.down = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.dropColumn('node_enable_solo_mining');
  });
};