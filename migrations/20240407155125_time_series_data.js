exports.up = function (knex) {
  return knex.schema.createTable('time_series_data', function (table) {
    table.increments('id').primary();
    table.text('uuid');
    table.float('hashrateInGh');
    table.float('poolHashrateInGh');
    table.float('poolHashrate');
    table.float('sharesAccepted');
    table.float('sharesRejected');
    table.float('sharesSent');
    table.float('errorRate');
    table.float('wattTotal');
    table.float('temperature');
    table.float('voltage');
    table.float('chipSpeed');
    table.float('fanRpm');
    table.timestamp('createdAt').defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('time_series_data');
};