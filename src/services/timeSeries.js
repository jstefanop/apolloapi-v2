const moment = require('moment');
const { GraphQLError } = require('graphql');

// Interval configuration: default time ranges and SQL date formats (all in UTC)
const INTERVAL_CONFIG = {
  tenmin: {
    defaultSubtract: { value: 6, unit: 'hours' },
    // Group by 10-minute blocks: floor minutes to nearest 10 (UTC)
    dateFormat: `strftime('%Y-%m-%d %H:', createdAt) || printf('%02d', (cast(strftime('%M', createdAt) as integer) / 10) * 10) || ':00'`,
    momentUnit: 'minutes',
    momentIncrement: 10,
  },
  hour: {
    defaultSubtract: { value: 1, unit: 'days' },
    dateFormat: `strftime('%Y-%m-%d %H:00:00', createdAt)`,
    momentUnit: 'hour',
    momentIncrement: 1,
  },
  day: {
    defaultSubtract: { value: 30, unit: 'days' },
    dateFormat: `strftime('%Y-%m-%d', createdAt)`,
    momentUnit: 'day',
    momentIncrement: 1,
  },
};

class TimeSeriesService {
  constructor(knex) {
    this.knex = knex;
  }

  // Get time series statistics
  // source: 'miner' (default) or 'solo'
  // interval: 'day' (default), 'hour', or 'tenmin'
  async getStats({ startDate, endDate, interval, itemId, source }) {
    try {
      // Set default values if not provided
      if (!interval) interval = 'day';
      if (!source) source = 'miner';

      const config = INTERVAL_CONFIG[interval] || INTERVAL_CONFIG.day;

      // Set default values for startDate and endDate based on interval (all in UTC)
      if (!startDate) {
        startDate = moment.utc().subtract(config.defaultSubtract.value, config.defaultSubtract.unit);
      } else {
        startDate = moment.utc(startDate);
      }
      if (!endDate) {
        endDate = moment.utc();
      } else {
        endDate = moment.utc(endDate);
      }

      const format = 'YYYY-MM-DD HH:mm:ssZ';

      startDate = startDate.format(format);
      endDate = endDate.format(format);

      if (!itemId) itemId = 'totals';

      // Get aggregated data based on source
      let data;
      if (source === 'solo') {
        data = await this._getSoloAggregateDataInRange(startDate, endDate, interval);
      } else {
        data = await this._getMinerAggregateDataInRange(startDate, endDate, interval, itemId);
      }

      return { data };
    } catch (error) {
      throw new GraphQLError(`Failed to get time series stats: ${error.message}`);
    }
  }

  // Helper method to get aggregated miner data in a time range
  async _getMinerAggregateDataInRange(startDate, endDate, interval, itemId) {
    try {
      const config = INTERVAL_CONFIG[interval] || INTERVAL_CONFIG.day;
      const dateFormat = config.dateFormat;

      // Query database for aggregated data
      const aggregateData = await this.knex('time_series_data')
        .select(
          this.knex.raw(`${dateFormat} as date`),
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
        .groupByRaw(dateFormat)
        .orderByRaw(dateFormat);

      // Create a result array with values for each interval in the range (all UTC)
      const result = [];
      let currentDate = moment.utc(startDate);
      const endDateObj = moment.utc(endDate);

      // Round start date to interval boundary (in UTC)
      if (interval === 'tenmin') {
        const minutes = currentDate.minutes();
        currentDate.minutes(Math.floor(minutes / 10) * 10).seconds(0).milliseconds(0);
      } else if (interval === 'hour') {
        currentDate.minutes(0).seconds(0).milliseconds(0);
      } else if (interval === 'day') {
        currentDate.hours(0).minutes(0).seconds(0).milliseconds(0);
      }

      while (currentDate <= endDateObj) {
        // Format the current date for output (ISO 8601 UTC)
        const formattedDate = currentDate.format();
        
        // Format for comparison with DB data
        const compareFormat = interval === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm';
        const currentCompare = currentDate.format(compareFormat);

        // Find data for the current interval
        const dataForDate = aggregateData.find((entry) => {
          const entryDate = moment.utc(entry.date, 'YYYY-MM-DD HH:mm:ss');
          return entryDate.format(compareFormat) === currentCompare;
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
        currentDate.add(config.momentIncrement, config.momentUnit);
      }

      return result;
    } catch (error) {
      console.error('Error while fetching miner time series:', error);
      throw error;
    }
  }

  // Helper method to get aggregated solo data in a time range
  async _getSoloAggregateDataInRange(startDate, endDate, interval) {
    try {
      const config = INTERVAL_CONFIG[interval] || INTERVAL_CONFIG.day;
      const dateFormat = config.dateFormat;

      // Query database for aggregated solo data
      const aggregateData = await this.knex('time_series_solo_data')
        .select(
          this.knex.raw(`${dateFormat} as date`),
          this.knex.raw('avg(users) as users'),
          this.knex.raw('avg(workers) as workers'),
          this.knex.raw('avg(idle) as idle'),
          this.knex.raw('avg(disconnected) as disconnected'),
          this.knex.raw('max(hashrate15m) as hashrate15m'),
          this.knex.raw('avg(accepted) as accepted'),
          this.knex.raw('avg(rejected) as rejected'),
          this.knex.raw('max(bestshare) as bestshare')
        )
        .whereBetween('createdAt', [startDate, endDate])
        .groupByRaw(dateFormat)
        .orderByRaw(dateFormat);

      // Create a result array with values for each interval in the range (all UTC)
      const result = [];
      let currentDate = moment.utc(startDate);
      const endDateObj = moment.utc(endDate);

      // Round start date to interval boundary (in UTC)
      if (interval === 'tenmin') {
        const minutes = currentDate.minutes();
        currentDate.minutes(Math.floor(minutes / 10) * 10).seconds(0).milliseconds(0);
      } else if (interval === 'hour') {
        currentDate.minutes(0).seconds(0).milliseconds(0);
      } else if (interval === 'day') {
        currentDate.hours(0).minutes(0).seconds(0).milliseconds(0);
      }

      while (currentDate <= endDateObj) {
        // Format the current date for output (ISO 8601 UTC)
        const formattedDate = currentDate.format();
        
        // Format for comparison with DB data
        const compareFormat = interval === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm';
        const currentCompare = currentDate.format(compareFormat);

        // Find data for the current interval
        const dataForDate = aggregateData.find((entry) => {
          const entryDate = moment.utc(entry.date, 'YYYY-MM-DD HH:mm:ss');
          return entryDate.format(compareFormat) === currentCompare;
        });

        // Add data or default values to the result
        result.push({
          date: formattedDate,
          users: dataForDate ? dataForDate.users : 0,
          workers: dataForDate ? dataForDate.workers : 0,
          idle: dataForDate ? dataForDate.idle : 0,
          disconnected: dataForDate ? dataForDate.disconnected : 0,
          hashrate15m: dataForDate ? dataForDate.hashrate15m : 0,
          accepted: dataForDate ? dataForDate.accepted : 0,
          rejected: dataForDate ? dataForDate.rejected : 0,
          bestshare: dataForDate ? dataForDate.bestshare : 0,
        });

        // Move to the next interval
        currentDate.add(config.momentIncrement, config.momentUnit);
      }

      return result;
    } catch (error) {
      console.error('Error while fetching solo time series:', error);
      throw error;
    }
  }
}

module.exports = (knex) => new TimeSeriesService(knex);