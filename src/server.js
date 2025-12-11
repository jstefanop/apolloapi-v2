const config = require('config');

// Import the app promise
const appPromise = require('./app');

const port = config.get('server.port');

// Start the server once the app is initialized
appPromise.then(app => {
  app.listen(port, () => {
    console.log(`ENV: ${process.env.NODE_ENV || 'dev'} - Server listening on port ${port}`);
  });
}).catch(error => {
  console.error('Failed to initialize the app:', error);
  process.exit(1);
});