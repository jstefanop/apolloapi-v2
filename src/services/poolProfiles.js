const { GraphQLError } = require('graphql');

// The user's saved pools — a list to pick from, not a list to mine to.
//
// Nothing here touches `pools` or calls generateConf(): saving a profile must
// never change what the miner is doing. The settings page applies a pool the way
// it always has; this only remembers one.
class PoolProfilesService {
  constructor(knex) {
    this.knex = knex;
  }

  async list() {
    try {
      const profiles = await this.knex('pool_profiles')
        .select('id', 'name', 'url', 'username', 'password')
        .orderBy('name', 'asc');
      return { profiles };
    } catch (error) {
      throw new GraphQLError(`Failed to list pool profiles: ${error.message}`);
    }
  }

  // Save under a name, replacing any profile already using it. That is the whole
  // correction story for now — with no manage screen, a typo would otherwise sit
  // in the list forever.
  async save({ name, url, username, password }) {
    const trimmedName = (name || '').trim();
    const trimmedUrl = (url || '').trim();

    if (!trimmedName) {
      throw new GraphQLError('A name is required to save a pool');
    }
    if (!trimmedUrl) {
      throw new GraphQLError('A pool URL is required to save a pool');
    }

    try {
      const existing = await this.knex('pool_profiles')
        .where({ name: trimmedName })
        .first();

      const row = {
        name: trimmedName,
        url: trimmedUrl,
        username: username ?? null,
        password: password ?? null,
      };

      if (existing) {
        // Scoped by id, never a bare update: this table is small and a missing
        // WHERE here would rewrite every profile the user has.
        await this.knex('pool_profiles')
          .where({ id: existing.id })
          .update({ ...row, updated_at: this.knex.fn.now() });
      } else {
        await this.knex('pool_profiles').insert(row);
      }

      const profile = await this.knex('pool_profiles')
        .select('id', 'name', 'url', 'username', 'password')
        .where({ name: trimmedName })
        .first();

      return { profile };
    } catch (error) {
      throw new GraphQLError(`Failed to save pool profile: ${error.message}`);
    }
  }
}

module.exports = (knex) => new PoolProfilesService(knex);
