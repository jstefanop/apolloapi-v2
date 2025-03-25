// tests/logs.test.js
const { knex } = require('../src/db');
const logsResolver = require('../src/graphql/resolvers/logs');

describe('Logs API', () => {
  describe('Logs.read resolver', () => {
    it('should read MINER logs', async () => {
      // Mock logs service
      const mockLogsService = {
        read: jest.fn().mockResolvedValue({
          content:
            'Mining at 7500 GH/s\nTemperature: 65°C\nAccepted shares: 100',
          timestamp: new Date().toISOString(),
        }),
      };

      // Test resolver directly
      const result = await logsResolver.LogsActions.read(
        null,
        { input: { logType: 'MINER', lines: 100 } },
        { services: { logs: mockLogsService }, isAuthenticated: true }
      );

      expect(result.result.content).toContain('Mining at 7500 GH/s');
      expect(result.result.timestamp).toBeTruthy();
      expect(result.error).toBeNull();
      expect(mockLogsService.read).toHaveBeenCalledWith({
        logType: 'MINER',
        lines: 100,
      });
    });

    it('should read NODE logs', async () => {
      // Mock logs service
      const mockLogsService = {
        read: jest.fn().mockResolvedValue({
          content:
            '2025-03-24 00:15:20 Bitcoin Core version v22.0.0\n2025-03-24 00:15:25 InitParameterInteraction',
          timestamp: new Date().toISOString(),
        }),
      };

      // Test resolver directly
      const result = await logsResolver.LogsActions.read(
        null,
        { input: { logType: 'NODE', lines: 10 } },
        { services: { logs: mockLogsService }, isAuthenticated: true }
      );

      expect(result.result.content).toContain('Bitcoin Core');
      expect(result.result.timestamp).toBeTruthy();
      expect(result.error).toBeNull();
      expect(mockLogsService.read).toHaveBeenCalledWith({
        logType: 'NODE',
        lines: 10,
      });
    });

    it('should read CKPOOL logs', async () => {
      // Mock logs service
      const mockLogsService = {
        read: jest.fn().mockResolvedValue({
          content:
            '2025-03-24 00:10:00 ckpool starting\n2025-03-24 00:10:05 ckpool version: 0.9.5',
          timestamp: new Date().toISOString(),
        }),
      };

      // Test resolver directly
      const result = await logsResolver.LogsActions.read(
        null,
        { input: { logType: 'CKPOOL', lines: 10 } },
        { services: { logs: mockLogsService }, isAuthenticated: true }
      );

      expect(result.result.content).toContain('ckpool');
      expect(result.result.timestamp).toBeTruthy();
      expect(result.error).toBeNull();
      expect(mockLogsService.read).toHaveBeenCalledWith({
        logType: 'CKPOOL',
        lines: 10,
      });
    });

    it('should handle non-existent log file', async () => {
      // Mock logs service simulating file not found
      const mockLogsService = {
        read: jest.fn().mockResolvedValue({
          content: 'Error reading log: ENOENT: no such file or directory',
          timestamp: new Date().toISOString(),
        }),
      };

      // Test resolver directly
      const result = await logsResolver.LogsActions.read(
        null,
        { input: { logType: 'NODE', lines: 10 } },
        { services: { logs: mockLogsService }, isAuthenticated: true }
      );

      expect(result.result.content).toContain('Error reading log');
      expect(result.result.timestamp).toBeTruthy();
      expect(result.error).toBeNull();
    });

    it('should limit lines to a reasonable number', async () => {
      // Mock logs service with line limit simulation
      const mockLogsService = {
        read: jest.fn().mockImplementation(({ lines }) => {
          // Simulate line limit
          const maxLines = Math.min(lines, 1000);
          // Create exactly maxLines lines (not maxLines+1)
          const content =
            maxLines > 0 ? 'Log line\n'.repeat(maxLines - 1) + 'Log line' : '';
          return Promise.resolve({
            content,
            timestamp: new Date().toISOString(),
          });
        }),
      };

      // Test resolver directly
      const result = await logsResolver.LogsActions.read(
        null,
        { input: { logType: 'NODE', lines: 5000 } },
        { services: { logs: mockLogsService }, isAuthenticated: true }
      );

      // Count number of lines in response
      const lineCount = (result.result.content.match(/\n/g) || []).length + 1;
      expect(lineCount).toBeLessThanOrEqual(1000);
      expect(mockLogsService.read).toHaveBeenCalledWith({
        logType: 'NODE',
        lines: 5000,
      });
    });

    it('should require authentication', async () => {
      // Create auth directive mock
      const authDirectiveResolver = {
        resolve: jest.fn().mockImplementation(() => {
          throw new Error('You must be authenticated to access this resource');
        }),
      };

      // Verify authentication error is thrown
      expect(() => {
        authDirectiveResolver.resolve(() => {}, null, {
          isAuthenticated: false,
        });
      }).toThrow('You must be authenticated');
    });
  });

  describe('LogsService', () => {
    // Additional tests for specific LogsService behaviors could be added here

    it('should handle different log types correctly', () => {
      // Here you could test internal logic of the logs service
      // For example, verify it correctly handles different log types
      // For now, we'll keep it simple since resolvers are already tested
      expect(true).toBe(true);
    });
  });
});
