exports.up = function (knex) {
  return knex.schema.createTable('service_status', (table) => {
    table.increments('id').primary();
    table.string('service_name').notNullable();
    table.string('status').notNullable();
    table.string('requested_status');
    table.timestamp('last_checked').defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('service_status');
};