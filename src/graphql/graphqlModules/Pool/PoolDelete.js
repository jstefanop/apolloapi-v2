export const typeDefs = `
  type PoolActions {
    delete (input: PoolDeleteInput!): EmptyOutput!
  }

  input PoolDeleteInput {
    id: Int!
  }
`

export const resolvers = {
  PoolActions: {
    delete (root, args, { dispatch }) {
      return dispatch('api/pools/delete', args.input)
    }
  }
}
