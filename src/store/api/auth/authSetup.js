const generator = require('generate-password')

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

      const rpcPassword = generator.generate({
        length: 12,
        numbers: true
      })

      await knex('settings').update({
        node_rpc_password: rpcPassword
      })

      utils.auth.changeSystemPassword(password)
      await utils.auth.changeNodeRpcPassword(rpcPassword)
    } catch (err) {
      console.log('ERROR', err);
    }
  })
}
