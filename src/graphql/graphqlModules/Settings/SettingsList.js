module.exports.typeDefs = `
  type SettingsActions {
    list: SettingListOutput!
  }

  type SettingListOutput {
    result: SettingListResult
    error: Error
  }

  type SettingListResult {
    settings: [Settings!]!
  }
`

module.exports.resolvers = {
  SettingsActions: {
    list (root, args, { dispatch }) {
      return dispatch('api/settings/list', args.input)
    }
  }
}
