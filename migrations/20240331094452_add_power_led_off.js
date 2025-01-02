export const up = (knex) => {
  return knex.schema.table('settings', (t) => {
    t.boolean('power_led_off').notNull().defaultTo(false);
  });
};

export const down = (knex) => {
  return knex.schema.table('settings', (t) => {
    t.dropColumn('power_led_off');
  });
};