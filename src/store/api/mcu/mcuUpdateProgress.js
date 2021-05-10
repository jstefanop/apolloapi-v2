const { join } = require('path')
const { exec } = require('child_process')
const fs = require('fs').promises
const path = require('path')
const _ = require('lodash')

module.exports = ({ define }) => {
  define('updateProgress', async (payload, { knex, errors, utils }) => {
    const data = await fs.readFile(`/tmp/update_progress`);
    const progress = parseInt(data.toString());
    return { value: progress }
  }, {
    auth: true
  })
}