exports.up = function(knex) {
  return knex.schema.table('service_status', function (table) {
    table.timestamp('requested_at');
  });
};

exports.down = function(knex) {
  return knex.schema.table('service_status', function (table) {
    table.dropColumn('requested_at');
  });
};
