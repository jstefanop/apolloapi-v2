module.exports.typeDefs = `
  type McuActions {
    shutdown: EmptyOutput!
  }
`

module.exports.resolvers = {
  McuActions: {
    shutdown (root, args, { dispatch }) {
      return dispatch('api/mcu/shutdown')
    }
  }
}
