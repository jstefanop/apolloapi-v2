export const up = (knex) => {
  return knex.schema.table('settings', (t) => {
    t.integer('node_max_connections').defaultTo(64);
    t.boolean('node_allow_lan').defaultTo(false);
  });
};

export const down = (knex) => {
  return knex.schema.table('settings', (t) => {
    t.dropColumn('node_max_connections');
    t.dropColumn('node_allow_lan');
  });
};