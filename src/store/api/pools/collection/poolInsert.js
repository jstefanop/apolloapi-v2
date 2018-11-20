const updateFields = {
  id: 'id',
  enabled: 'enabled',
  donation: 'donation',
  url: 'url',
  username: 'username',
  password: 'password',
  proxy: 'proxy',
}

module.exports = ({ define }) => {
  define('insert', async (data = {}, { dispatch, knex, errors, utils }) => {
    const insertData = {}
    Object.keys(data).forEach(key => {
      if (updateFields[key]) {
        insertData[updateFields[key]] = data[key]
      }
    })
    insertData.index = knex('pools').select(knex.raw('coalesce(max(??), -1) + ?', ['index', 1]))
    return await knex('pools').insert(insertData).returning('*')
  })
}
