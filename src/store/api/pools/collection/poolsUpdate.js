export default ({ define }) => {
	define('updateAll', async (data = {}, { dispatch, knex, errors, utils }) => {
		return await knex.transaction(async (trx) => {
			await trx.delete().from('pools');
			await trx.insert(data).into('pools');
		});
	});
};
