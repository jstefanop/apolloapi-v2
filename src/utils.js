const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const config = require('config')

module.exports.auth = {
  hashPassword (password) {
    return bcrypt.hash(password, 12)
  },

  comparePassword (password, hash) {
    if (!password || !hash) {
      return false
    }
    return bcrypt.compare(password, hash)
  },

  generateAccessToken () {
    const accessToken = jwt.sign({}, config.get('server.secret'), {
      subject: 'apollouser',
      audience: 'auth'
    })
    return {
      accessToken
    }
  },
}
