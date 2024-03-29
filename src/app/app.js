const path = require('path')
const express = require('express')
const cors = require('cors');
const graphqlApp = require('./graphqlApp')

const app = express()

app.use(cors());

app.use('/api/graphql', graphqlApp)

module.exports = app
