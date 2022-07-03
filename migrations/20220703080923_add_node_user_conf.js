exports.up = function(knex, Promise) {
    return knex.schema.table('settings', function(t) {
        t.text('node_user_conf').defaultTo(null);
    });
};

exports.down = function(knex, Promise) {
    return knex.schema.table('settings', function(t) {
        t.dropColumn('node_user_conf');
    });
};