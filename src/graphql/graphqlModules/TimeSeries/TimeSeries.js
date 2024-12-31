export const typeDefs = `
  type Query {
    TimeSeries: TimeSeriesActions
  }
`;

export const resolvers = {
  Query: {
    TimeSeries() {
      return {};
    }
  }
};
