export const up = async (knex) => {
    // remove default pool
    await knex('pools').where({ donation: 1 }).del();

    return knex.schema.table('settings', (t) => {
        t.integer('fan_low').notNullable().defaultTo(40);
        t.integer('fan_high').notNullable().defaultTo(60);
        t.integer('voltage').notNullable().defaultTo(30).alter();
        t.integer('frequency').notNullable().defaultTo(25).alter();
    });
};

export const down = (knex) => {
    return knex.schema.table('settings', (t) => {
        t.dropColumn('fan_low');
        t.dropColumn('fan_high');
    });
};