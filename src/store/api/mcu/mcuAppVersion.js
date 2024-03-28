const { join } = require('path')
const { exec } = require('child_process')
const axios = require('axios')

module.exports = ({ define }) => {
  define('version', async (payload, { knex, errors, utils }) => {
    const gitAppVersion = await axios.get(`https://raw.githubusercontent.com/jstefanop/apolloui-v2/${process.env.NODE_ENV === 'development' ? 'dev' : 'main'}/package.json`);
    const currentAppVersion = (gitAppVersion && gitAppVersion.data) ? gitAppVersion.data.version : null;
    return process.env.NODE_ENV === 'development' ? currentAppVersion : currentAppVersion;
  }, {
    auth: true
  })
}