// Pools the user has chosen to keep, so a custom one entered once can be picked
// again from the list instead of retyped.
//
// Deliberately NOT the `pools` table: that one is what the miner is running
// right now, and `configurator.js` turns every row in it into miner CLI args. A
// saved-but-not-selected profile living there would be a pool the device starts
// mining to because someone bookmarked it.
//
// `name` is unique because it is what the list shows, and because re-saving
// under the same name is the only way to correct a profile: there is no manage
// screen in this first cut.
exports.up = async function up(knex) {
  await knex.schema.createTable('pool_profiles', (table) => {
    table.increments('id');
    table.timestamps(false, true);
    table.text('name').notNullable().unique();
    table.text('url').notNullable();
    table.text('username');
    table.text('password');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('pool_profiles');
};
