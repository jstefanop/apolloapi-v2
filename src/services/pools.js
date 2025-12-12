const { GraphQLError } = require('graphql');
const generateConf = require('../configurator');

class PoolsService {
  constructor(knex, utils) {
    this.knex = knex;
    this.utils = utils;
  }

  // List all pools
  async list() {
    try {
      const pools = await this._getPoolsCollection();
      return { pools };
    } catch (error) {
      throw new GraphQLError(`Failed to list pools: ${error.message}`);
    }
  }

  // Create a new pool
  async create(poolData) {
    try {
      // Insert the pool into the database
      const [id] = await this._insertPool(poolData);

      // Get the newly created pool
      const pool = await this._getPoolById(id);

      // Generate updated miner configuration
      await generateConf();

      return { pool };
    } catch (error) {
      throw new GraphQLError(`Failed to create pool: ${error.message}`);
    }
  }

  // Update a pool
  async update(poolData) {
    try {
      // Update the pool in the database
      await this._updatePool(poolData);

      // Get the updated pool
      const pool = await this._getPoolById(poolData.id);

      // Generate updated miner configuration
      await generateConf();

      return { pool };
    } catch (error) {
      throw new GraphQLError(`Failed to update pool: ${error.message}`);
    }
  }

  // Update all pools
  async updateAll(poolsData) {
    try {
      // Update all pools in a transaction
      await this._updateAllPools(poolsData);

      // Get all pools after update
      const pools = await this._getPoolsCollection();

      // Generate updated miner configuration
      await generateConf(pools);

      return { pools };
    } catch (error) {
      throw new GraphQLError(`Failed to update all pools: ${error.message}`);
    }
  }

  // Delete a pool
  async delete(poolData) {
    try {
      // Delete the pool from the database
      await this._deletePool(poolData.id);

      // Generate updated miner configuration
      await generateConf();
    } catch (error) {
      throw new GraphQLError(`Failed to delete pool: ${error.message}`);
    }
  }

  // Helper method to get a collection of pools
  async _getPoolsCollection() {
    const pools = await this.knex('pools')
      .select(
        'id',
        'enabled',
        'donation',
        'url',
        'username',
        'password',
        'proxy',
        'index'
      )
      .orderBy('index', 'asc');

    return pools;
  }

  // Helper method to get a pool by ID
  async _getPoolById(id) {
    const pool = await this.knex('pools')
      .select(
        'id',
        'enabled',
        'donation',
        'url',
        'username',
        'password',
        'proxy',
        'index'
      )
      .where('id', id)
      .first();

    if (!pool) {
      throw new GraphQLError(`Pool with ID ${id} not found`);
    }

    return pool;
  }

  // Helper method to insert a new pool
  async _insertPool(data) {
    const insertData = this._preparePoolData(data);

    // If index not provided, find the next available index
    if (!insertData.index) {
      const maxIndex = await this.knex('pools')
        .max('index as maxIndex')
        .first();

      insertData.index = (maxIndex.maxIndex || 0) + 1;
    }

    const ids = await this.knex('pools').insert(insertData);
    return Array.isArray(ids) ? ids : [ids];
  }

  // Helper method to update a pool
  async _updatePool(data) {
    const updateData = this._preparePoolData(data);

    // Remove id from update data
    delete updateData.id;

    await this.knex('pools')
      .where('id', data.id)
      .update(updateData);
  }

  // Helper method to update all pools
  async _updateAllPools(poolsData) {
    return await this.knex.transaction(async function (trx) {
      // First, delete all existing pools
      await trx.delete().from('pools');

      // Then, insert all new pools
      await trx.insert(poolsData).into('pools');
    });
  }

  // Helper method to delete a pool
  async _deletePool(id) {
    await this.knex('pools')
      .where('id', id)
      .delete();
  }

  // Helper method to prepare pool data for database operations
  _preparePoolData(data) {
    // Mapping of input fields to database fields
    const fieldMapping = {
      id: 'id',
      enabled: 'enabled',
      donation: 'donation',
      url: 'url',
      username: 'username',
      password: 'password',
      proxy: 'proxy',
      index: 'index'
    };

    // Create a new object with mapped fields
    const preparedData = {};

    // Only include fields that exist in the input data
    Object.keys(data).forEach(key => {
      if (fieldMapping[key] && data[key] !== undefined) {
        preparedData[fieldMapping[key]] = data[key];
      }
    });

    return preparedData;
  }
}

module.exports = (knex, utils) => new PoolsService(knex, utils);