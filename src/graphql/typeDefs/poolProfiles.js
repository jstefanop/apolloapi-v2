const gql = require('graphql-tag');

// Saved pools, kept apart from `Pool` on purpose: that namespace edits what the
// miner is running, this one only remembers where it could run.
module.exports = gql`
  extend type Query {
    PoolProfiles: PoolProfileActions
  }

  extend type Mutation {
    PoolProfiles: PoolProfileMutations
  }

  type PoolProfileActions {
    list: PoolProfileListOutput! @auth
  }

  type PoolProfileMutations {
    # Saving under an existing name replaces it — the only way to fix a typo
    # while there is no manage screen.
    save(input: PoolProfileSaveInput!): PoolProfileSaveOutput! @auth
  }

  type PoolProfile {
    id: Int!
    name: String!
    url: String!
    username: String
    password: String
  }

  input PoolProfileSaveInput {
    name: String!
    url: String!
    username: String
    password: String
  }

  type PoolProfileListOutput {
    result: PoolProfileListResult
    error: Error
  }

  type PoolProfileListResult {
    profiles: [PoolProfile!]!
  }

  type PoolProfileSaveOutput {
    result: PoolProfileSaveResult
    error: Error
  }

  type PoolProfileSaveResult {
    profile: PoolProfile!
  }
`;
