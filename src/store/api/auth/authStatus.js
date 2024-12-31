export default ({ define }) => {
  define('status', async (payload, { knex }) => {
    const [setup] = await knex('setup').select('*').limit(1);
    const status = setup ? 'done' : 'pending';
    return {
      status
    };
  });
};
