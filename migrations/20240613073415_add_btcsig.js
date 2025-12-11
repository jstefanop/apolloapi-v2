exports.up = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.text('btcsig').defaultTo('/mined by Solo FutureBit Apollo/').notNullable();
  });
};

exports.down = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.dropColumn('btcsig');
  });
};