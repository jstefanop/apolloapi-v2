const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

// E2E against the "fake device": backend in NODE_ENV=development (miner/solo/mcu/
// systemctl + node all faked) + the real Next UI. No hardware, deterministic.
const E2E_DB = path.join(__dirname, 'e2e', '.tmp', 'e2e.sqlite');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // shared backend state → run serially
  workers: 1,
  reporter: 'list',
  globalSetup: require.resolve('./e2e/global-setup.js'),
  use: {
    baseURL: 'http://localhost:3000',
    storageState: path.join(__dirname, 'e2e', '.tmp', 'state.json'),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Fresh fake-device DB on each cold start.
      command: `bash -c "rm -f ${E2E_DB}* ; NODE_ENV=development PORT=5002 DATABASE_URL=${E2E_DB} yarn dev"`,
      url: 'http://localhost:5002/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'yarn dev',
      cwd: path.join(__dirname, 'apolloui-v2'),
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
