const fs = require('fs').promises;

module.exports = ({ define }) => {
  define(
    'formatProgress',
    async (payload, { knex, errors, utils }) => {
      try {
        // 1. Check if the file exists
        const filePath = '/tmp/format_node_disk_c_done';
        let fileExists = true;
        try {
          await fs.access(filePath, fs.constants.F_OK);
        } catch (error) {
          if (error.code === 'ENOENT') {
            // File doesn't exist
            console.log('format_node_disk_c_done file not found. Returning default progress.');
            fileExists = false;
          } else {
            throw error;
          }
        }

        if (!fileExists) {
          return { value: 0 };
        }

        const data = await fs.readFile(filePath);
        const progress = parseInt(data.toString());
        return { value: progress };
      } catch (error) {
        console.log('formatProgress', error);
        return { value: 0 };
      }
    },
    {
      auth: true,
    }
  );
};
