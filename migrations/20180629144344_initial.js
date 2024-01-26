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
    table.enum('miner_mode', ['eco', 'balanced', 'turbo', 'custom']).notNullable()
    table.float('voltage').notNullable()
    table.integer('frequency').notNullable()
    table.text('connected_wifi')
    table.boolean('left_sidebar_visibility').notNullable()
    table.boolean('left_sidebar_extended').notNullable()
    table.boolean('right_sidebar_visibility').notNullable()
    table.enum('temperature_unit', ['f', 'c']).notNullable()
    table.boolean('custom_approval').notNull().defaultTo(false)
  })

  // default settings
  await knex('settings').insert({
    miner_mode: 'eco',
    voltage: 30,
    frequency: 25,
    connected_wifi: null,
    left_sidebar_visibility: true,
    left_sidebar_extended: true,
    right_sidebar_visibility: false,
    temperature_unit: 'c'
  })

  // pools
  await knex.schema.createTable('pools', table => {
    table.increments('id')
    table.timestamps(false, true)
    table.boolean('enabled').notNullable()
    table.integer('donation').notNullable().defaultTo(0)
    table.text('url').notNullable()
    table.text('username')
    table.text('password')
    table.text('proxy')
    table.integer('index').notNullable()
  })

  // default pool
  await knex('pools').insert({
    enabled: true,
    donation: 1,
    url: 'stratum+tcp://stratum.slushpool.com:3333',
    username: 'jstefanop.a1',
    password: 'a1',
    index: 99
  })
}

exports.down = async function (knex) {
  await knex.raw('drop schema if exists public cascade')
  await knex.raw('create schema public')
}
