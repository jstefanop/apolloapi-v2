module.exports = ({ define }) => {
  define('updateAll', async (data = {}, { dispatch, knex, errors, utils }) => {
    return await knex.transaction(async function(trx) {
      await trx.delete().from('pools')
      await trx.insert(data).into('pools')
    });
  })
}
