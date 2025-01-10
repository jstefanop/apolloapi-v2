const path = require('path');
const express = require('express');
const cors = require('cors');
const _ = require('lodash');
const { knex } = require('../db');
const store = require('./../store');
const graphqlApp = require('./graphqlApp');

// Run the scheduler
require('./scheduler');

const app = express();

app.use(cors());

app.use('/api/graphql', graphqlApp);

module.exports = app;
