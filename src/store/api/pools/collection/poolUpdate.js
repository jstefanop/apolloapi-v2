const updateFields = {
  id: 'id',
  enabled: 'enabled',
  donation: 'donation',
  url: 'url',
  username: 'username',
  password: 'password',
  proxy: 'proxy',
};

export default ({ define }) => {
  define('update', async (data = {}, { dispatch, knex, errors, utils }) => {
    const updateData = {};
    Object.keys(data).forEach(key => {
      if (updateFields[key]) {
        updateData[updateFields[key]] = data[key];
      }
    });
    return await knex('pools').update(updateData).where('id', data.id);
  });
};
