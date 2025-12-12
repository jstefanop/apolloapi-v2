// Migration to update btcsig to store only user-customizable part
// The prefix "/FutureBit-" and trailing "/" are now added automatically in code

exports.up = async function (knex) {
  // Get all settings and update btcsig values
  const settings = await knex('settings').select('id', 'btcsig');
  
  for (const setting of settings) {
    if (setting.btcsig) {
      let newBtcsig = setting.btcsig;
      
      // Remove leading slash if present
      if (newBtcsig.startsWith('/')) {
        newBtcsig = newBtcsig.slice(1);
      }
      
      // Remove trailing slash if present
      if (newBtcsig.endsWith('/')) {
        newBtcsig = newBtcsig.slice(0, -1);
      }
      
      // Remove "FutureBit-" prefix if present
      if (newBtcsig.startsWith('FutureBit-')) {
        newBtcsig = newBtcsig.slice(10); // "FutureBit-" is 10 chars
      }
      
      // Update only if changed
      if (newBtcsig !== setting.btcsig) {
        await knex('settings')
          .where('id', setting.id)
          .update({ btcsig: newBtcsig });
      }
    }
  }
};

exports.down = async function (knex) {
  // Revert: add back the full format with /FutureBit-{value}/
  const settings = await knex('settings').select('id', 'btcsig');
  
  for (const setting of settings) {
    if (setting.btcsig) {
      // Only convert if not already in full format
      if (!setting.btcsig.startsWith('/')) {
        const fullBtcsig = `/FutureBit-${setting.btcsig}/`;
        await knex('settings')
          .where('id', setting.id)
          .update({ btcsig: fullBtcsig });
      }
    }
  }
};
