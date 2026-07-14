const config = require('config');

// Import the httpServer promise (wraps Express + Apollo + WebSocket)
const appPromise = require('./app');

const port = config.get('server.port');

appPromise.then(httpServer => {
  httpServer.listen(port, () => {
    console.log(`ENV: ${process.env.NODE_ENV || 'dev'} - Server listening on port ${port}`);
  });
}).catch(error => {
  console.error('Failed to initialize the app:', error);
  process.exit(1);
});
