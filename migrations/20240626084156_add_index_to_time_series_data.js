exports.up = function (knex) {
  return knex.schema.table('time_series_data', function (table) {
    table.index('uuid');
    table.index('createdAt');
  });
};

exports.down = function (knex) {
  return knex.schema.table('time_series_data', function (table) {
    table.dropIndex('uuid');
    table.dropIndex('createdAt');
  });
};