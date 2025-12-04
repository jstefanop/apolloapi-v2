exports.up = function (knex) {
  return knex.schema.createTable('time_series_solo_data', function (table) {
    table.increments('id').primary();
    table.integer('users').defaultTo(0);
    table.integer('workers').defaultTo(0);
    table.integer('idle').defaultTo(0);
    table.integer('disconnected').defaultTo(0);
    table.float('hashrate15m').defaultTo(0);
    table.bigInteger('accepted').defaultTo(0);
    table.bigInteger('rejected').defaultTo(0);
    table.bigInteger('bestshare').defaultTo(0);
    table.timestamp('createdAt').defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('time_series_solo_data');
};
