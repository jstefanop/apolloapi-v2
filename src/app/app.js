const express = require('express');
const cors = require('cors');
const setupApolloServer = require('./graphqlApp');

// Create Express app
const app = express();
app.use(cors());

// Setup Apollo Server and apply middleware
async function initializeApp() {
  const appWithApollo = await setupApolloServer(app);

  // Run the scheduler
  require('./scheduler');

  return appWithApollo;
}

// Initialize the app
const appPromise = initializeApp();

// Export the app promise
module.exports = appPromise;