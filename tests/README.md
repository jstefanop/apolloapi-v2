# apolloapi Tests

This folder contains automated tests for the apolloapi GraphQL API.

## Test Structure

The tests are organized according to the major components of the API:

- **auth.test.js**: Tests for authentication endpoints
- **settings.test.js**: Tests for settings management
- **pools.test.js**: Tests for mining pool configuration
- **miner.test.js**: Tests for miner operations
- **node.test.js**: Tests for Bitcoin node operations
- **services.test.js**: Tests for service status monitoring
- **timeSeries.test.js**: Tests for time series data
- **logs.test.js**: Tests for log reading
- **mcu.test.js**: Tests for MCU operations

## Running Tests

To run all tests:

```bash
npm test
```

To run tests with coverage:

```bash
npm run test:coverage
```

To run a specific test file:

```bash
npx jest tests/auth.test.js
```

## Test Setup

The tests use:

- Jest as the test runner
- SQLite in-memory database for testing
- Mocked file system and child_process operations
- Authentication tokens for protected endpoints

## Common Test Utilities

Common testing utilities are in `utils.js`:

- `setupAuth()`: Creates a test user and returns auth token
- `createTestPool()`: Creates a test mining pool
- `createTimeSeriesData()`: Creates test time series data
- `updateServiceStatus()`: Updates service status

## Test Configuration

The test configuration is in `config.js`. It uses:

- In-memory SQLite database
- Test secret key for JWT