const config = require('config')
const app = require('./app')

const port = config.get('server.port')

app.listen(port, () => {
  console.log(`ENV: ${process.env.NODE_ENV || 'dev'} - Server listening on port ${port}`)
})
