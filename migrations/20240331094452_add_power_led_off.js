exports.up = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.boolean('power_led_off').notNull().defaultTo(false);
  });
};

exports.down = function (knex, Promise) {
  return knex.schema.table('settings', function (t) {
    t.dropColumn('power_led_off');
  });
};