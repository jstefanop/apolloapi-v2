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
    if (process.env.BITCOIND_PASSWORD) exec(`sudo sed -i s/BITCOIND_PASSWORD.*/BITCOIND_PASSWORD=${password}/g /opt/apolloapi/.env`)
    else exec(`sudo echo "BITCOIND_PASSWORD=${password}" >> /opt/apolloapi/.env`)
    exec('sudo systemctl restart node')
    exec('sudo systemctl restart apollo-ui')
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
