export const up = (knex) => {
    return knex.schema.table('settings', (t) => {
        t.text('node_user_conf').defaultTo(null);
    });
};

export const down = (knex) => {
    return knex.schema.table('settings', (t) => {
        t.dropColumn('node_user_conf');
    });
};