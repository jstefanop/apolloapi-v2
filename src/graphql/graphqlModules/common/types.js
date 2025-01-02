export const typeDefs = `
  type Error {
    code: String!
    message: String!
    type: String
    severity: String
    reasons: reasonsOutput
  }

  type reasonsOutput {
    path: String
    message: String
    reason: String
  }

  type EmptyOutput {
    blank: String
  }
`;
