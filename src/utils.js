const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { exec } = require('child_process')
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

  changeSystemPassword (password) {
    exec(`sudo usermod --password ${password} futurebit`)
  },

  changeNodeRpcPassword (password) {
    exec(`sudo sed -i s/rpcpassword.*/rpcpassword=${password}/g /opt/apolloapi/backend/node/bitcoin.conf`)
    exec('sudo systemctl restart node')
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
