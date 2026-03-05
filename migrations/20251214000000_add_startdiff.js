exports.up = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.integer('startdiff').defaultTo(1024).notNullable();
  });
};

exports.down = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.dropColumn('startdiff');
  });
};
