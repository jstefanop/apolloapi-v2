const express = require('express')
const config = require('config')
const graphqlApp = require('./graphqlApp')

const app = express()

app.use('/graphql', graphqlApp)

module.exports = app
