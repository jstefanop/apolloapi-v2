module.exports.typeDefs = `
  type McuActions {
    version: McuAppVersionOutput!
  }

  type McuAppVersionOutput {
    result: String
    error: Error
  }
`

module.exports.resolvers = {
  McuActions: {
    version (root, args, { dispatch }) {
      return dispatch('api/mcu/version')
    }
  }
}
