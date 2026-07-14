const {
  serializeConfig,
  serializeRule,
  serializeEvent,
  serializeState,
  deserializeRuleInput,
} = require('../serialize/automation');

// Same shape as every other namespace here: { result, error }, never a thrown
// error across the wire.
const wrap = async (fn) => {
  try {
    return { result: await fn(), error: null };
  } catch (error) {
    return { result: null, error: { message: error.message } };
  }
};

module.exports = {
  Query: {
    Automation: () => ({}),
  },

  AutomationActions: {
    config: (_, __, { services }) =>
      wrap(async () => serializeConfig(await services.automation.getConfig())),

    rules: (_, __, { services }) =>
      wrap(async () => (await services.automation.listRules()).map(serializeRule)),

    events: (_, { limit }, { services }) =>
      wrap(async () => (await services.automation.listEvents(limit || 50)).map(serializeEvent)),

    signals: (_, __, { services }) => wrap(async () => services.automation.descriptors()),

    // Evaluates and returns without acting: this is what the rule editor calls to
    // answer "what would you do right now?" before the user commits to a rule.
    state: (_, __, { services }) =>
      wrap(async () => serializeState(await services.automation.evaluate({ preview: true }))),

    updateConfig: (_, { input }, { services }) =>
      wrap(async () => serializeConfig(await services.automation.updateConfig(input))),

    createRule: (_, { input }, { services }) =>
      wrap(async () => serializeRule(await services.automation.createRule(deserializeRuleInput(input)))),

    updateRule: (_, { id, input }, { services }) =>
      wrap(async () =>
        serializeRule(await services.automation.updateRule(id, deserializeRuleInput(input)))
      ),

    deleteRule: async (_, { id }, { services }) => {
      try {
        await services.automation.deleteRule(id);
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    },

    setOverride: (_, { input }, { services }) =>
      wrap(async () => serializeConfig(await services.automation.setOverride(input || {}))),

    clearOverride: (_, __, { services }) =>
      wrap(async () => serializeConfig(await services.automation.clearOverride())),
  },
};
