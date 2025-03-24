const updateFields = {
  id: 'id',
  enabled: 'enabled',
  donation: 'donation',
  url: 'url',
  username: 'username',
  password: 'password',
  proxy: 'proxy',
  index: 'index',
};

module.exports = ({ define }) => {
  define('insert', async (data = {}, { dispatch, knex, errors, utils }) => {
    const insertData = {};
    Object.keys(data).forEach((key) => {
      if (updateFields[key]) {
        insertData[updateFields[key]] = data[key];
      }
    });

    // Ensure index is set if not provided
    if (!insertData.index) {
      const maxIndex = await knex('pools').max('index as maxIndex').first();
      insertData.index = (maxIndex.maxIndex || 0) + 1;
    }

    const ids = await knex('pools').insert(insertData);
    return Array.isArray(ids) ? ids : [ids];
  });
};
