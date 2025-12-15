/**
 * Fix node_software values that were incorrectly saved in enum format (core_28_1)
 * instead of backend format (core-28.1)
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Convert enum format to backend format
  // core_28_1 -> core-28.1
  // core_25_1 -> core-25.1
  // knots_29_2 -> knots-29.2
  
  await knex('settings')
    .where('node_software', 'core_28_1')
    .update({ node_software: 'core-28.1' });
  
  await knex('settings')
    .where('node_software', 'core_25_1')
    .update({ node_software: 'core-25.1' });
  
  await knex('settings')
    .where('node_software', 'knots_29_2')
    .update({ node_software: 'knots-29.2' });
  
  console.log('Fixed node_software values from enum format to backend format');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Revert to enum format (if needed for rollback)
  await knex('settings')
    .where('node_software', 'core-28.1')
    .update({ node_software: 'core_28_1' });
  
  await knex('settings')
    .where('node_software', 'core-25.1')
    .update({ node_software: 'core_25_1' });
  
  await knex('settings')
    .where('node_software', 'knots-29.2')
    .update({ node_software: 'knots_29_2' });
};
