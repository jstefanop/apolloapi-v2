const { ensureEnvFile } = require('./env');

async function initializeApp() {
  ensureEnvFile();
  if (process.env.APOLLO_BOOTSTRAPPED !== '1') {
    // Manual and development launches do not have the systemd prerequisite.
    const { bootstrap } = require('./bootstrap');
    await bootstrap();
  }
  return require('./server');
}

initializeApp().catch(error => {
  console.error('Failed to initialize app:', error);
  process.exit(1);
});