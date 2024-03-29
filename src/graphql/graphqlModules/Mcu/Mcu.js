module.exports.typeDefs = `
  type Query {
    Mcu: McuActions
  }
`

module.exports.resolvers = {
  Query: {
    Mcu () {
      return {}
    }
  }
}
