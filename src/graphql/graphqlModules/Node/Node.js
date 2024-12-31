export const typeDefs = `
  type Query {
    Node: NodeActions
  }
`;

export const resolvers = {
  Query: {
    Node() {
      return {};
    }
  }
};
