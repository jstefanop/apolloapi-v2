module.exports.typeDefs = `
  type SettingsActions {
    read: SettingsUpdateOutput!
  }
`

module.exports.resolvers = {
  SettingsActions: {
    read (root, args, { dispatch }) {
      return dispatch('api/settings/read', args.input)
    }
  }
}
