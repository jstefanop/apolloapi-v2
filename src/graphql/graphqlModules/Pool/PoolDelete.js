module.exports.typeDefs = `
  type PoolActions {
    delete (input: PoolDeleteInput!): EmptyOutput!
  }

  input PoolDeleteInput {
    id: Int!
  }
`

module.exports.resolvers = {
  PoolActions: {
    delete (root, args, { dispatch }) {
      return dispatch('api/pools/delete', args.input)
    }
  }
}
