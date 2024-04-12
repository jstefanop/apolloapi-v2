module.exports = ({ define }) => {
  define('setup', async ({ password }, { knex, errors, utils }) => {
    try {
      // TODO transaction
      const [ setup ] = await knex('setup').select('*').limit(1)
      if (setup) {
        throw new errors.AuthorizationError('Setup already done')
      }
      await knex('setup').insert({
        password: await utils.auth.hashPassword(password)
      })

      utils.auth.changeSystemPassword(password)
    } catch (err) {
      console.log('ERROR', err);
    }
  })
}
