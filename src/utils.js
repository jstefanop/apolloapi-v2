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

  async changeNodeRpcPassword (password) {
    exec(`sudo sed -i s/rpcpassword.*/rpcpassword=${password}/g /opt/apolloapi/backend/node/bitcoin.conf`)
    if (process.env.BITCOIND_PASSWORD) exec(`sudo sed -i s/BITCOIND_PASSWORD.*/BITCOIND_PASSWORD=${password}/g /opt/apolloapi/.env`)
    else exec(`echo "BITCOIND_PASSWORD=${password}" | sudo tee -a /opt/apolloapi/.env`)
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

  async manageTor (settings)  {
    if (settings.nodeEnableTor) {
      exec(`echo "server=1\nrpcuser=futurebit\nrpcpassword=${settings.nodeRpcPassword}\ndaemon=0\nmaxconnections=32\nupnp=1\nuacomment=FutureBit-Apollo-Node\n#TOR_START\nproxy=127.0.0.1:9050\nlisten=1\nbind=127.0.0.1\nonlynet=onion\ndnsseed=0\ndns=0\n#TOR_END" | sudo tee /opt/apolloapi/backend/node/bitcoin.conf`)
    } else {
      exec(`echo "server=1\nrpcuser=futurebit\nrpcpassword=${settings.nodeRpcPassword}\ndaemon=0\nmaxconnections=32\nupnp=1\nuacomment=FutureBit-Apollo-Node" | sudo tee /opt/apolloapi/backend/node/bitcoin.conf`)
    }

    exec('sudo systemctl restart node')
  }
}
