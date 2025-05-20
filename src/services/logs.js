const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const { GraphQLError } = require('graphql');

// Convert exec to use promises
const execPromise = util.promisify(exec);

class LogsService {
  constructor(knex) {
    this.knex = knex;
  }

  // Read logs from file
  async read({ logType, lines = 100 }) {
    try {
      let logPath;

      // Determine the path based on log type
      switch (logType) {
        case 'CKPOOL':
          // Check multiple possible locations for ckpool.log
          const possiblePaths = [
            path.resolve(
              __dirname,
              '../../backend/ckpool/logs/ckpool.log'
            ),
            path.resolve(__dirname, '../../backend/ckpool/ckpool.log'),
            '/opt/apolloapi/backend/ckpool/logs/ckpool.log',
            '/opt/apolloapi/backend/ckpool/ckpool.log',
          ];

          for (const p of possiblePaths) {
            try {
              await fs.access(p, fs.constants.R_OK);
              logPath = p;
              break;
            } catch (e) {
              console.log(`CKPOOL log not found at: ${p}`);
            }
          }

          if (!logPath) {
            console.log(
              'Could not find CKPOOL log file in any of the expected locations'
            );
            // In development, proceed with a fake path for sample data
            if (process.env.NODE_ENV !== 'production') {
              logPath = possiblePaths[0];
            } else {
              throw new GraphQLError('CKPOOL log file not found');
            }
          }
          break;
        case 'MINER':
          // The miner is run in multiple screen sessions, so we need to capture output from all of them
          if (process.env.NODE_ENV === 'production') {
            try {
              // Safely limit the number of lines
              const safeLines = Math.min(Math.max(parseInt(lines) || 100, 1), 1000);

              // First, get list of all miner screen sessions
              const { stdout: screenList } = await execPromise('sudo screen -ls | grep "miner"');
              
              // Extract session IDs from the output
              const sessionMatches = screenList.match(/\d+\.miner/g) || [];
              
              if (sessionMatches.length === 0) {
                return {
                  content: 'No miner screen sessions found.',
                  timestamp: new Date().toISOString(),
                };
              }

              // Read logs from each session and merge them
              const allLogs = await Promise.all(
                sessionMatches.map(async (session) => {
                  try {
                    const { stdout } = await execPromise(
                      `sudo screen -S ${session} -X hardcopy /tmp/miner_screen_${session}.log && cat /tmp/miner_screen_${session}.log | tail -n ${safeLines}`
                    );
                    return stdout || `No output available for session ${session}`;
                  } catch (error) {
                    return `Error reading session ${session}: ${error.message}`;
                  }
                })
              );

              // Merge all logs with session identifiers
              const mergedLogs = allLogs
                .map((log, index) => `=== Session ${sessionMatches[index]} ===\n${log}`)
                .join('\n\n');

              return {
                content: mergedLogs || 'No miner screen output available.',
                timestamp: new Date().toISOString(),
              };
            } catch (error) {
              console.error(
                `Error getting miner screen output: ${error.message}`
              );
              return {
                content: `Unable to retrieve miner screen output: ${error.message}. No miner screen sessions found.`,
                timestamp: new Date().toISOString(),
              };
            }
          } else {
            // Fallback to the log file path for development
            logPath = path.resolve(
              __dirname,
              '../../backend/apollo-miner/miner.log'
            );
          }
          break;
        case 'NODE':
          logPath = '/media/nvme/Bitcoin/debug.log';
          break;
        default:
          throw new GraphQLError('Invalid log type');
      }

      // Safely limit the number of lines
      const safeLines = Math.min(Math.max(parseInt(lines) || 100, 1), 1000);

      // Use tail command to get the last N lines of the log file
      // This is more efficient than reading the entire file for large logs
      let content;

      if (process.env.NODE_ENV === 'production') {
        try {
          // First check if file exists
          await fs.access(logPath, fs.constants.R_OK);

          // Use -f flag to not fail if file doesn't exist
          const { stdout } = await execPromise(
            `tail -n ${safeLines} -f ${logPath} 2>/dev/null | head -n ${safeLines}`
          );
          content = stdout || `No content found in ${logPath}`;
        } catch (error) {
          console.error(`Error executing tail command: ${error.message}`);
          content = `Error reading log file: ${error.message}`;
        }
      } else {
        // For development, we'll read the file directly if it exists
        // or generate sample content if it doesn't
        try {
          const fileStats = await fs.stat(logPath).catch(() => null);
          if (fileStats && fileStats.isFile()) {
            const fileContent = await fs.readFile(logPath, 'utf8');
            const allLines = fileContent.split('\n');
            content = allLines.slice(-safeLines).join('\n');
          } else {
            content = `[DEV MODE] Sample log content for ${logType}\n`.repeat(
              10
            );
          }
        } catch (err) {
          // File doesn't exist in dev mode
          console.log(`Error in dev mode: ${err.message}`);
          content = `[DEV MODE] Sample log content for ${logType}\n`.repeat(
            10
          );
        }
      }

      return {
        content: content || `No content available for ${logType} log`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Error reading log file: ${error.message}`);
      return {
        content: `Error reading log: ${error.message}`,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = (knex) => new LogsService(knex);