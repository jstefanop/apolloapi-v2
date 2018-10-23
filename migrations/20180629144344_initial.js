exports.up = async function (knex) {
  // setup
  await knex.schema.createTable('setup', table => {
    table.increments('id')
    table.timestamps(false, true)
    table.text('password')
  })
}

exports.down = async function (knex) {
  await knex.raw('drop schema if exists public cascade')
  await knex.raw('create schema public')
}
