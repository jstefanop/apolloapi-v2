// tests/timeSeries.test.js
const { knex } = require('../src/db');
const timeSeriesResolver = require('../src/graphql/resolvers/timeSeries');

describe('TimeSeries API', () => {
  beforeEach(async () => {
    // Clear time series data before each test
    await knex('time_series_data').del();
  });

  describe('TimeSeries.stats resolver', () => {
    it('should return time series data with day interval', async () => {
      // Generate mock time series data
      const mockTimeSeriesData = generateMockTimeSeriesData(10, 'day');

      // Mock time series service
      const mockTimeSeriesService = {
        getStats: jest.fn().mockResolvedValue({
          data: mockTimeSeriesData
        })
      };

      // Prepare input parameters
      const now = new Date();
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const input = {
        startDate: tenDaysAgo.toISOString(),
        endDate: now.toISOString(),
        interval: 'day',
        itemId: 'totals'
      };

      // Test resolver directly
      const result = await timeSeriesResolver.TimeSeriesActions.stats(
        null,
        { input },
        { services: { timeSeries: mockTimeSeriesService } }
      );

      // Verify result structure and content
      expect(result.result.data).toBeTruthy();
      expect(result.result.data.length).toBeGreaterThanOrEqual(10);

      // Check first entry properties
      const firstEntry = result.result.data[0];
      expect(firstEntry).toHaveProperty('date');
      expect(firstEntry).toHaveProperty('hashrate');
      expect(firstEntry).toHaveProperty('poolHashrate');
      expect(firstEntry).toHaveProperty('accepted');
      expect(firstEntry).toHaveProperty('rejected');
      expect(firstEntry).toHaveProperty('sent');
      expect(firstEntry).toHaveProperty('errors');
      expect(firstEntry).toHaveProperty('watts');
      expect(firstEntry).toHaveProperty('temperature');
      expect(firstEntry).toHaveProperty('voltage');
      expect(firstEntry).toHaveProperty('chipSpeed');
      expect(firstEntry).toHaveProperty('fanRpm');

      expect(result.error).toBeNull();
    });

    it('should return data for an hourly interval', async () => {
      // Generate mock time series data for hourly interval
      const mockTimeSeriesData = generateMockTimeSeriesData(24, 'hour');

      // Mock time series service
      const mockTimeSeriesService = {
        getStats: jest.fn().mockResolvedValue({
          data: mockTimeSeriesData
        })
      };

      // Prepare input parameters
      const now = new Date();
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const input = {
        startDate: oneDayAgo.toISOString(),
        endDate: now.toISOString(),
        interval: 'hour',
        itemId: 'totals'
      };

      // Test resolver directly
      const result = await timeSeriesResolver.TimeSeriesActions.stats(
        null,
        { input },
        { services: { timeSeries: mockTimeSeriesService } }
      );

      // Verify result structure and content
      expect(result.result.data).toBeTruthy();
      expect(result.result.data.length).toBeGreaterThanOrEqual(23);
      expect(result.result.data.length).toBeLessThanOrEqual(25);

      expect(result.error).toBeNull();
    });

    it('should use default parameters when not provided', async () => {
      // Generate mock time series data with default parameters
      const mockTimeSeriesData = generateMockTimeSeriesData(5, 'day');

      // Mock time series service
      const mockTimeSeriesService = {
        getStats: jest.fn().mockResolvedValue({
          data: mockTimeSeriesData
        })
      };

      // Test resolver directly with empty input
      const result = await timeSeriesResolver.TimeSeriesActions.stats(
        null,
        { input: {} },
        { services: { timeSeries: mockTimeSeriesService } }
      );

      // Verify result
      expect(result.result.data).toBeTruthy();
      expect(result.result.data.length).toBeGreaterThan(0);
      expect(result.error).toBeNull();
    });

    it('should handle errors when fetching time series data', async () => {
      // Mock time series service with error
      const mockTimeSeriesService = {
        getStats: jest.fn().mockRejectedValue(new Error('Failed to retrieve time series data'))
      };

      // Test resolver directly
      const result = await timeSeriesResolver.TimeSeriesActions.stats(
        null,
        { input: {} },
        { services: { timeSeries: mockTimeSeriesService } }
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error.message).toBe('Failed to retrieve time series data');
    });
  });
});

// Helper function to generate mock time series data
function generateMockTimeSeriesData(count, interval) {
  const data = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    // Create entries for the specified interval
    const date = new Date(now);
    if (interval === 'day') {
      date.setDate(date.getDate() - i);
    } else if (interval === 'hour') {
      date.setHours(date.getHours() - i);
    }

    data.push({
      date: date.toISOString(),
      hashrate: 70 + Math.random() * 10,
      poolHashrate: 68 + Math.random() * 10,
      accepted: 100 + Math.random() * 20,
      rejected: Math.random() * 5,
      sent: 105 + Math.random() * 20,
      errors: Math.random() * 2,
      watts: 250 + Math.random() * 20,
      temperature: 55 + Math.random() * 10,
      voltage: 12 + Math.random() * 0.5,
      chipSpeed: 650 + Math.random() * 20,
      fanRpm: 3000 + Math.random() * 500
    });
  }

  return data;
}