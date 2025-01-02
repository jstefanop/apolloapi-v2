export const up = (knex) => {
  return knex.schema.table('settings', (t) => {
    t.text('btcsig').defaultTo('/mined by Solo FutureBit Apollo/').notNullable();
  });
};

export const down = (knex) => {
  return knex.schema.table('settings', (t) => {
    t.dropColumn('btcsig');
  });
};