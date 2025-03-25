const moment = require('moment');
const { GraphQLError } = require('graphql');

class TimeSeriesService {
  constructor(knex) {
    this.knex = knex;
  }

  // Get time series statistics
  async getStats({ startDate, endDate, interval, itemId }) {
    try {
      // Set default values if not provided
      if (!interval) interval = 'day';

      // Set default values for startDate and endDate
      if (!startDate) startDate = moment().subtract(interval === 'day' ? 30 : 1, 'days');
      if (!endDate) endDate = moment();

      const format = 'YYYY-MM-DD HH:mm:ssZ';

      startDate = moment(startDate).utc().format(format);
      endDate = moment(endDate).utc().format(format);

      if (!itemId) itemId = 'totals';

      // Get aggregated data for the specified time range
      const data = await this._getAggregateDataInRange(
        startDate,
        endDate,
        interval,
        itemId
      );

      return { data };
    } catch (error) {
      throw new GraphQLError(`Failed to get time series stats: ${error.message}`);
    }
  }

  // Helper method to get aggregated data in a time range
  async _getAggregateDataInRange(startDate, endDate, interval, itemId) {
    try {
      // Determine format based on interval
      const dateFormat = interval === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';

      // Query database for aggregated data
      const aggregateData = await this.knex('time_series_data')
        .select(
          this.knex.raw(
            `strftime('${dateFormat}', datetime(createdAt, 'localtime')) as date`
          ),
          this.knex.raw('avg(hashrateInGh) as hashrate'),
          this.knex.raw('avg(poolHashrateInGh) as poolHashrate'),
          this.knex.raw('avg(sharesAccepted) as accepted'),
          this.knex.raw('avg(sharesRejected) as rejected'),
          this.knex.raw('avg(sharesSent) as sent'),
          this.knex.raw('avg(errorRate) as errors'),
          this.knex.raw('avg(wattTotal) as watts'),
          this.knex.raw('avg(temperature) as temperature'),
          this.knex.raw('avg(voltage) as voltage'),
          this.knex.raw('avg(chipSpeed) as chipSpeed'),
          this.knex.raw('avg(fanRpm) as fanRpm')
        )
        .whereBetween('createdAt', [startDate, endDate])
        .where('uuid', itemId)
        .groupByRaw(`strftime('${dateFormat}', datetime(createdAt, 'localtime'))`)
        .orderByRaw(
          `strftime('${dateFormat}', datetime(createdAt, 'localtime'))`
        );

      // Create a result array with values for each day/hour in the range
      const result = [];
      let currentDate = moment(startDate);
      const endDateObj = moment(endDate);

      while (currentDate <= endDateObj) {
        // Format the current date
        const formattedDate = currentDate.utc().format();

        // Find data for the current date/hour
        const dataForDate = aggregateData.find((entry) => {
          const entryDate = moment(entry.date).format('YYYY-MM-DD HH:mm:ssZ');
          return moment(entryDate).utc().isSame(currentDate.utc(), interval);
        });

        // Add data or default values to the result
        result.push({
          date: formattedDate,
          hashrate: dataForDate ? dataForDate.hashrate : 0,
          poolHashrate: dataForDate ? dataForDate.poolHashrate : 0,
          accepted: dataForDate ? dataForDate.accepted : 0,
          rejected: dataForDate ? dataForDate.rejected : 0,
          sent: dataForDate ? dataForDate.sent : 0,
          errors: dataForDate ? dataForDate.errors : 0,
          watts: dataForDate ? dataForDate.watts : 0,
          temperature: dataForDate ? dataForDate.temperature : 0,
          voltage: dataForDate ? dataForDate.voltage : 0,
          chipSpeed: dataForDate ? dataForDate.chipSpeed : 0,
          fanRpm: dataForDate ? dataForDate.fanRpm : 0,
        });

        // Move to the next interval
        currentDate.add(1, interval);
      }

      return result;
    } catch (error) {
      console.error('Error while fetching time series:', error);
      throw error;
    }
  }
}

module.exports = (knex) => new TimeSeriesService(knex);