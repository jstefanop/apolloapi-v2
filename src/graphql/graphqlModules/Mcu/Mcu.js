export const typeDefs = `
  type Query {
    Mcu: McuActions
  }
`;

export const resolvers = {
  Query: {
    Mcu() {
      return {};
    }
  }
};
