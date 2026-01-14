exports.up = function (knex) {
  return knex.schema.createTable('recent_blocks', function (table) {
    table.increments('id').primary();
    table.string('block_hash', 64).unique().notNullable();
    table.integer('height').notNullable();
    table.text('block_data').notNullable(); // JSON
    table.text('error').nullable(); // NULL if success, error message if failed
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Indexes for efficient queries
    table.index('height', 'idx_recent_blocks_height');
    table.index('block_hash', 'idx_recent_blocks_hash');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('recent_blocks');
};
