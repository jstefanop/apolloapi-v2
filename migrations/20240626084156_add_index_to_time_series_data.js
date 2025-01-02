export const up = (knex) => {
  return knex.schema.table('time_series_data', (table) => {
    table.index('uuid');
    table.index('createdAt');
  });
};

export const down = (knex) => {
  return knex.schema.table('time_series_data', (table) => {
    table.dropIndex('uuid');
    table.dropIndex('createdAt');
  });
};