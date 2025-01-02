export const up = (knex) => {
    return knex.schema.table('settings', (t) => {
        t.boolean('api_allow').notNull().defaultTo(false);
    });
};

export const down = (knex) => {
    return knex.schema.table('settings', (t) => {
        t.dropColumn('api_allow');
    });
};