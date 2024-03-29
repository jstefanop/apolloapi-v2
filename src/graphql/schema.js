const { join } = require('path')
const { loadGraphql } = require('backend-helpers')

const schema = loadGraphql(join(__dirname, 'graphqlModules'))

module.exports = schema
