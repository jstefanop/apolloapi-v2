exports.up = async function (knex) {
  // Update existing records that have the old default value
  await knex('settings')
    .where('btcsig', '/mined by Solo FutureBit Apollo/')
    .update({ btcsig: '/FutureBit-Apollo/' });
};

exports.down = async function (knex) {
  // Revert to old value
  await knex('settings')
    .where('btcsig', '/FutureBit-Apollo/')
    .update({ btcsig: '/mined by Solo FutureBit Apollo/' });
};
