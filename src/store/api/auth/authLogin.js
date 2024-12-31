export default ({ define }) => {
  define('login', async ({ password }, { knex, errors, utils }) => {
    // TODO transaction
    const [setup] = await knex('setup').select('*').limit(1);
    if (!setup) {
      throw new errors.AuthorizationError('Setup not finished');
    }
    const isPasswordValid = await utils.auth.comparePassword(password, setup.password);
    if (!isPasswordValid) {
      throw new errors.AuthenticationError('Invalid password').addReason({
        path: 'password',
        message: 'Invalid password'
      });
    }
    const { accessToken } = utils.auth.generateAccessToken();
    return { accessToken };
  });
};
