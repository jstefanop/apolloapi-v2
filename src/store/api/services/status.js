const moment = require('moment');

module.exports = ({ define }) => {
  define('status', async (payload, { knex, errors }) => {
    try {
      const { serviceName } = payload || {};

      const convertToUtcDateTime = (timestamp) => {
        if (!timestamp) return null;
        return moment(Number(timestamp))
          .utc()
          .format();
      };

      const fieldsMapping = [
        'id',
        'service_name as serviceName',
        'status',
        'requested_status as requestedStatus',
        'requested_at as requestedAt',
        'last_checked as lastChecked',
      ];

      let data;

      if (serviceName) {
        const status = await knex('service_status')
          .select(fieldsMapping)
          .where({ service_name: serviceName })
          .first();

        if (status) {
          status.lastChecked = convertToUtcDateTime(status.lastChecked);
          status.requestedAt = convertToUtcDateTime(status.requestedAt);
        }

        data = [status];
      } else {
        const statuses = await knex('service_status')
          .select(fieldsMapping)
          .orderBy('id', 'desc');

        for (const row of statuses) {
          row.lastChecked = convertToUtcDateTime(row.lastChecked);
          row.requestedAt = convertToUtcDateTime(row.requestedAt);
        }

        data = statuses;
      }

      return { data };
    } catch (error) {
      console.error('Error fetching service status:', error);
      throw errors.internalServerError();
    }
  });
};