module.exports = ({ define }) => {
  define('read', async ({
    where = {},
    one,
    forUpdate
  }, {
      context: { trx } = {},
      knex
    }) => {
    const readQ = (trx || knex)('pools')

    if (where.id) {
      readQ.where('id', where.id)
    }

    readQ.select(
      'id',
      'enabled',
      'donation',
      'url',
      'username',
      'password',
      'proxy',
      'index'
    )

    readQ.orderBy('index', 'asc')

    if (forUpdate) {
      readQ.forUpdate()
    }

    const items = await readQ

    if (one) {
      return items[0] || null
    }

    return {
      items
    }
  })
}
