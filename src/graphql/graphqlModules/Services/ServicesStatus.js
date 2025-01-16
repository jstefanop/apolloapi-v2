module.exports.typeDefs = `
  type ServicesActions {
    stats (input: StatusInput): StatusOutput!
  }

  input StatusInput {
    serviceName: String
  }

  type StatusOutput {
    result: Status
    error: Error
  }

  type Status {
    data: [StatusData!]!
  }

  type StatusData {
    id: String
    serviceName: String
    status: String
    requestedStatus: String
    requestedAt: DateTime
    lastChecked: DateTime
  }
`;

module.exports.resolvers = {
  ServicesActions: {
    stats(root, args, { dispatch }) {
      return dispatch('api/services/status', args.input);
    },
  },
};
