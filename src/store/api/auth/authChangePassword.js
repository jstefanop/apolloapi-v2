export default ({ define }) => {
  define('changePassword', async ({ password }, { knex, errors, utils }) => {
    // TODO transaction
    const [setup] = await knex('setup').select('*').limit(1);
    if (!setup) {
      throw new errors.AuthorizationError('Setup not finished');
    }
    await knex('setup').update({
      password: await utils.auth.hashPassword(password)
    });

    utils.auth.changeSystemPassword(password);
  }, {
    auth: true 
  });
};
