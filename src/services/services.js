const moment = require('moment');
const { GraphQLError } = require('graphql');

class ServicesService {
  constructor(knex) {
    this.knex = knex;
  }

  // Get service status statistics
  async getStats({ serviceName } = {}) {
    try {
      // Helper function to convert timestamp to UTC datetime
      const convertToUtcDateTime = (timestamp) => {
        if (!timestamp) return null;
        return moment(Number(timestamp))
          .utc()
          .format();
      };

      // Define fields mapping
      const fieldsMapping = [
        'id',
        'service_name as serviceName',
        'status',
        'requested_status as requestedStatus',
        'requested_at as requestedAt',
        'last_checked as lastChecked',
      ];

      let data;

      // If serviceName is provided, get status for that service
      if (serviceName) {
        const status = await this.knex('service_status')
          .select(fieldsMapping)
          .where({ service_name: serviceName })
          .first();

        if (status) {
          // Convert timestamps to UTC format
          status.lastChecked = convertToUtcDateTime(status.lastChecked);
          status.requestedAt = convertToUtcDateTime(status.requestedAt);
        }

        data = [status];
      } else {
        // Get status for all services
        const statuses = await this.knex('service_status')
          .select(fieldsMapping)
          .orderBy('id', 'desc');

        // Convert timestamps for all records
        for (const row of statuses) {
          row.lastChecked = convertToUtcDateTime(row.lastChecked);
          row.requestedAt = convertToUtcDateTime(row.requestedAt);
        }

        data = statuses;
      }

      return { data };
    } catch (error) {
      console.error('Error fetching service status:', error);
      throw new GraphQLError(`Failed to get service status: ${error.message}`);
    }
  }
}

module.exports = (knex) => new ServicesService(knex);