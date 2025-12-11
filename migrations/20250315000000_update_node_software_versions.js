/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Update existing values from old format to new format
  // core-latest -> core-28.1 (default)
  // knots-latest -> knots-29.2
  await knex('settings')
    .where('node_software', 'core-latest')
    .update({ node_software: 'core-28.1' });
  
  await knex('settings')
    .where('node_software', 'knots-latest')
    .update({ node_software: 'knots-29.2' });
  
  // Update any invalid values to default
  await knex('settings')
    .whereNotIn('node_software', ['core-25.1', 'core-28.1', 'knots-29.2'])
    .update({ node_software: 'core-28.1' });
  
  // Update default for new records (if column doesn't have default set)
  // This is handled by the migration that adds the column, but we ensure consistency
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Revert to old format (if needed for rollback)
  await knex('settings')
    .where('node_software', 'core-28.1')
    .orWhere('node_software', 'core-25.1')
    .update({ node_software: 'core-latest' });
  
  await knex('settings')
    .where('node_software', 'knots-29.2')
    .update({ node_software: 'knots-latest' });
};
