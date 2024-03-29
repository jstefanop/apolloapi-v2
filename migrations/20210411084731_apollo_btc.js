exports.up = async function(knex, Promise) {
	// remove default pool
	await knex('pools').where({ donation: 1 }).del();

    return knex.schema.table('settings', function(t) {
        t.integer('fan_low').notNullable().defaultTo(40);
        t.integer('fan_high').notNullable().defaultTo(60);
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