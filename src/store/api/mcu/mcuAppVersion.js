const { join } = require('path')
const { exec } = require('child_process')
const axios = require('axios')

module.exports = ({ define }) => {
  define('version', async (payload, { knex, errors, utils }) => {
    const gitAppVersion = await axios.get('https://raw.githubusercontent.com/jstefanop/apolloui/production-BTC/package.json');
    const currentAppVersion = (gitAppVersion && gitAppVersion.data) ? gitAppVersion.data.version : null;
    return currentAppVersion
  }, {
    auth: true
  })
}