module.exports.typeDefs = `
  type McuActions {
    updateProgress: McuUpdateProgressOutput!
  }


  type McuUpdateProgressOutput {
    result: McuUpdateProgressResult
    error: Error
  }

  type McuUpdateProgressResult {
  	value: Int
  }
`

module.exports.resolvers = {
  McuActions: {
    updateProgress (root, args, { dispatch }) {
      return dispatch('api/mcu/updateProgress')
    }
  }
}
