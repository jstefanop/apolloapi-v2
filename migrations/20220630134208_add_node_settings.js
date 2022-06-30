exports.up = function(knex, Promise) {
    return knex.schema.table('settings', function(t) {
        t.text('node_rpc_password').defaultTo(null);
        t.boolean('node_enable_tor').notNull().defaultTo(false);
    });
};

exports.down = function(knex, Promise) {
    return knex.schema.table('settings', function(t) {
        t.dropColumn('node_rpc_password');
        t.dropColumn('node_enable_tor');
    });
};