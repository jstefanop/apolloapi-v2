const config = require('config')
const app = require('./app')

const port = config.get('server.port')

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
