const path = require('path')
const express = require('express')
const cors = require('cors');
const graphqlApp = require('./graphqlApp')
const buildPath = path.join(__dirname, '../../apolloui/build');

const app = express()

app.use(cors());

app.use('/api/graphql', graphqlApp)

if (process.env.NODE_ENV === 'production') app.use(express.static(buildPath));

app.get('*', function (req, res) {
	if (process.env.NODE_ENV === 'production') res.sendFile(buildPath + '/index.html');
	else res.json({ message: 'API DEV server running' })
});

module.exports = app
