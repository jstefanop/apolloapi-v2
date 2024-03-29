module.exports.typeDefs = `
  type McuActions {
    reboot: EmptyOutput!
  }
`

module.exports.resolvers = {
  McuActions: {
    reboot (root, args, { dispatch }) {
      return dispatch('api/mcu/reboot')
    }
  }
}
