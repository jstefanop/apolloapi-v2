exports.up = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.integer('mindiff').defaultTo(1).notNullable();
  });
};

exports.down = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.dropColumn('mindiff');
  });
};
