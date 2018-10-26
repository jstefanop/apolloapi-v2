exports.up = async function (knex) {
  // setup
  await knex.schema.createTable('setup', table => {
    table.increments('id')
    table.timestamps(false, true)
    table.text('password')
  })

  // settings
  await knex.schema.createTable('settings', table => {
    table.increments('id')
    table.timestamps(false, true)
    table.enum('miner_mode', ['eco', 'turbo', 'custom']).notNullable()
    table.float('voltage').notNullable()
    table.integer('frequency').notNullable()
    table.integer('fan').notNullable()
    table.text('connected_wifi')
    table.boolean('left_sidebar_visibility').notNullable()
    table.boolean('left_sidebar_extended').notNullable()
    table.boolean('right_sidebar_visibility').notNullable()
    table.enum('temperature_unit', ['f', 'c']).notNullable()
  })

  // default settings
  await knex('settings').insert({
    miner_mode: 'eco',
    voltage: 0.5,
    frequency: 450,
    fan: -1,
    connected_wifi: null,
    left_sidebar_visibility: true,
    left_sidebar_extended: true,
    right_sidebar_visibility: false,
    temperature_unit: 'f'
  })
}

exports.down = async function (knex) {
  await knex.raw('drop schema if exists public cascade')
  await knex.raw('create schema public')
}
