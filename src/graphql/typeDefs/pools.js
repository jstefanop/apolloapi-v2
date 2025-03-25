const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Pool: PoolActions
  }

  type PoolActions {
    list: PoolListOutput! @auth
    create(input: PoolCreateInput!): PoolCreateOutput! @auth
    update(input: PoolUpdateInput!): PoolUpdateOutput! @auth
    updateAll(input: PoolUpdateAllInput!): PoolsUpdateOutput! @auth
    delete(input: PoolDeleteInput!): EmptyOutput! @auth
  }

  type PoolListOutput {
    result: PoolListResult
    error: Error
  }

  type PoolListResult {
    pools: [Pool!]!
  }

  input PoolCreateInput {
    enabled: Boolean!
    donation: Int
    url: String!
    username: String
    password: String
    proxy: String
    index: Int
  }

  type PoolCreateOutput {
    result: PoolCreateResult
    error: Error
  }

  type PoolCreateResult {
    pool: Pool!
  }

  input PoolUpdateInput {
    id: Int!
    enabled: Boolean
    donation: Int
    url: String
    username: String
    password: String
    proxy: String
  }

  type PoolUpdateOutput {
    result: PoolUpdateResult
    error: Error
  }

  type PoolUpdateResult {
    pool: Pool!
  }

  input PoolDeleteInput {
    id: Int!
  }

  input PoolUpdateAllInputItem {
    index: Int!
    donation: Int
    enabled: Boolean!
    url: String!
    username: String
    password: String
    proxy: String
  }

  input PoolUpdateAllInput {
    pools: [PoolUpdateAllInputItem!]!
  }

  type PoolsUpdateOutput {
    result: PoolsUpdateResult
    error: Error
  }

  type PoolsUpdateResult {
    pools: [Pool!]!
  }

  type Pool {
    id: Int!
    enabled: Boolean!
    donation: Int
    url: String!
    username: String
    password: String
    proxy: String
    index: Int!
  }
`;