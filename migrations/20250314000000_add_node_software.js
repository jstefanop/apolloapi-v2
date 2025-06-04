/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('settings', 'node_software');
  if (!hasColumn) {
    await knex.schema.table('settings', function (t) {
      t.string('node_software').defaultTo('core-latest').notNullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('settings', 'node_software');
  if (hasColumn) {
    await knex.schema.table('settings', function (t) {
      t.dropColumn('node_software');
    });
  }
}; 