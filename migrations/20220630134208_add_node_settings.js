export const up = (knex) => {
    return knex.schema.table('settings', (t) => {
        t.text('node_rpc_password').defaultTo(null);
        t.boolean('node_enable_tor').notNull().defaultTo(false);
    });
};

export const down = (knex) => {
    return knex.schema.table('settings', (t) => {
        t.dropColumn('node_rpc_password');
        t.dropColumn('node_enable_tor');
    });
};