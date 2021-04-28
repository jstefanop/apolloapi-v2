module.exports.typeDefs = `
  type McuActions {
    update: EmptyOutput!
  }
`

module.exports.resolvers = {
  McuActions: {
    update (root, args, { dispatch }) {
      return dispatch('api/mcu/update')
    }
  }
}
