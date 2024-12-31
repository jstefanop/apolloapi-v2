import generateConf from '../../../configurator.js';

const updateAll = async (payload, { dispatch, errors, utils }) => {
  await dispatch('api/pools/collection/updateAll', payload);
  const { items: pools } = await dispatch('api/pools/collection/read', {});
  
  await generateConf(pools);

  return {
    pools
  };
};

export default ({ define }) => {
  define('updateAll', updateAll, {
    auth: true 
  });
};
