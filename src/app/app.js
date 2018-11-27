const path = require('path')
const express = require('express')
const config = require('config')
const graphqlApp = require('./graphqlApp')
const buildPath = path.join(__dirname, '../../build');

const app = express()

app.use('/api/graphql', graphqlApp)

if (process.env.NODE_ENV === 'production') app.use(express.static(buildPath));

app.get('*', function (req, res) {
	res.sendFile(buildPath + '/index.html');
});

module.exports = app
