export default ({ define }) => {
  define('delete', async ({ id }, { dispatch, knex, errors, utils }) => {
    return await knex('pools').delete().where('id', id);
  });
};
