const jwt = require('jsonwebtoken')
const config = require('config')

const accessToken = jwt.sign({}, config.get('server.secret'), {
  subject: 'apollouser',
  audience: 'auth'
})

console.log(accessToken)