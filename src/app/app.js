const http = require('http');
const express = require('express');
const cors = require('cors');
const setupApolloServer = require('./graphqlApp');

// Create Express app
const app = express();
app.use(cors());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Setup Apollo Server + WebSocket server, then run scheduler
async function initializeApp() {
  const httpServer = http.createServer(app);
  await setupApolloServer(app, httpServer);

  // Run the scheduler (starts PubSub timers and service monitor)
  require('./scheduler');

  return httpServer;
}

// Initialize the app
const appPromise = initializeApp();

// Export the httpServer promise
module.exports = appPromise;
