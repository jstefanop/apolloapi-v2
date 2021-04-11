exports.up = function(knex, Promise) {
    return knex.schema.table('settings', function(t) {
        t.integer('fan_low').notNullable().defaultTo(0);
        t.integer('fan_high').notNullable().defaultTo(0);
        t.integer('voltage').notNullable().defaultTo(30).alter();
        t.integer('frequency').notNullable().defaultTo(25).alter();
    });
};

exports.down = function(knex, Promise) {
    return knex.schema.table('settings', function(t) {
        t.dropColumn('fan_low');
        t.dropColumn('fan_high');
    });
};