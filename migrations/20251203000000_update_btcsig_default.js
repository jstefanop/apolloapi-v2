exports.up = async function (knex) {
  // Update existing records that have the old default value
  await knex('settings')
    .where('btcsig', '/mined by Solo FutureBit Apollo/')
    .update({ btcsig: '/FutureBit-mined by Solo Apollo/' });
};

exports.down = async function (knex) {
  // Revert to old value
  await knex('settings')
    .where('btcsig', '/FutureBit-mined by Solo Apollo/')
    .update({ btcsig: '/mined by Solo FutureBit Apollo/' });
};
