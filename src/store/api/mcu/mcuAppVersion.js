import axios from 'axios';

export default ({ define }) => {
  define(
    'version',
    async (payload, { knex, errors, utils }) => {
      try {
        const gitAppVersion = await axios.get(
          `https://raw.githubusercontent.com/jstefanop/apolloui-v2/${
            process.env.NODE_ENV === 'development' ? 'dev' : 'main'
          }/package.json`
        );
        const currentAppVersion =
          gitAppVersion && gitAppVersion.data
            ? gitAppVersion.data.version
            : null;
        return currentAppVersion;
      } catch (e) {
        console.log(e);
        return e.toString();
      }
    },
    {
      auth: true,
    }
  );
};
