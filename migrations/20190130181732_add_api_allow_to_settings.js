exports.up = function(knex, Promise) {
    return knex.schema.table('settings', function(t) {
        t.boolean('api_allow').notNull().defaultTo(false);
    });
};

exports.down = function(knex, Promise) {
    return knex.schema.table('settings', function(t) {
        t.dropColumn('api_allow');
    });
};