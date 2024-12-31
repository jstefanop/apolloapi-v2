export const typeDefs = `
  type SettingsActions {
    read: SettingsUpdateOutput!
  }
`;

export const resolvers = {
  SettingsActions: {
    read: (root, args, { dispatch }) => {
      return dispatch('api/settings/read', args.input);
    }
  }
};
