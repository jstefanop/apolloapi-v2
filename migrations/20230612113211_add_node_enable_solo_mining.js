export const up = (knex) => {
  return knex.schema.table('settings', (t) => {
    t.boolean('node_enable_solo_mining').notNull().defaultTo(false);
  });
};

export const down = (knex) => {
  return knex.schema.table('settings', (t) => {
    t.dropColumn('node_enable_solo_mining');
  });
};