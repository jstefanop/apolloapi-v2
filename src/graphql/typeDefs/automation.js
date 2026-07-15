const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Automation: AutomationActions
  }

  type AutomationActions {
    config: AutomationConfigOutput! @auth
    rules: AutomationRulesOutput! @auth
    events(limit: Int): AutomationEventsOutput! @auth

    """
    The signals the engine can reason about, self-described: the UI builds the
    condition form from these instead of hardcoding a list.
    """
    signals: AutomationSignalsOutput! @auth

    """
    What the engine would do right now, with the values behind it. Evaluates
    without acting and without writing to the event log.
    """
    state: AutomationStateOutput! @auth

    updateConfig(input: AutomationConfigInput!): AutomationConfigOutput! @auth
    createRule(input: AutomationRuleInput!): AutomationRuleOutput! @auth
    updateRule(id: Int!, input: AutomationRuleInput!): AutomationRuleOutput! @auth
    deleteRule(id: Int!): EmptyOutput! @auth

    "Pause the automation for a while — what a manual start/stop does implicitly."
    setOverride(input: OverrideInput): AutomationConfigOutput! @auth
    clearOverride: AutomationConfigOutput! @auth

    "One-off probe of the MQTT broker with the given (or stored) credentials."
    testMqtt(input: MqttConfigInput!): MqttTestOutput! @auth

    "Subscribe to a wildcard for a few seconds and return the topics seen."
    discoverMqtt(input: MqttConfigInput!, prefix: String, seconds: Int): MqttDiscoverOutput! @auth
  }

  type MqttTestOutput {
    result: MqttTestResult
    error: Error
  }

  type MqttTestResult {
    ok: Boolean!
    message: String
  }

  type MqttDiscoverOutput {
    result: MqttDiscoverResult
    error: Error
  }

  type MqttDiscoverResult {
    ok: Boolean!
    error: String
    topics: [MqttTopic!]!
  }

  type MqttTopic {
    topic: String!
    "A sample of the last payload (truncated)."
    sample: String
    "Dot-paths to numeric fields when the payload is JSON — candidate jsonPaths."
    jsonPaths: [String!]
  }

  enum MatchMode {
    all
    any
  }

  enum ActionType {
    off
    mode
  }

  # ---------------------------------------------------------------- config

  type AutomationConfig {
    enabled: Boolean!
    "Evaluate and log every decision, but never touch the miner."
    dryRun: Boolean!
    latitude: Float
    longitude: Float
    timezone: String
    "keep | off | on:<mode>"
    fallbackAction: String!
    tariff: Tariff
    minOnMinutes: Int!
    minOffMinutes: Int!
    minChangeMinutes: Int!
    maxCyclesPerHour: Int!
    defaultHysteresis: Float!
    overrideMinutes: Int!
    overrideUntil: String
    overrideReason: String
    mqtt: MqttConfig
  }

  type MqttConfig {
    enabled: Boolean
    host: String
    port: Int
    username: String
    tls: Boolean
    "Live connection state of the broker link."
    status: MqttStatus
    "Topic → signal mappings; each becomes an input.<name> number signal."
    inputs: [MqttInput!]
  }

  type MqttStatus {
    connected: Boolean!
    error: String
  }

  type MqttInput {
    name: String!
    topic: String!
    "Optional dot-path into a JSON payload (e.g. 'solar.surplus')."
    jsonPath: String
    unit: String
  }

  input MqttConfigInput {
    enabled: Boolean
    host: String
    port: Int
    username: String
    password: String
    tls: Boolean
    inputs: [MqttInputInput!]
  }

  input MqttInputInput {
    name: String!
    topic: String!
    jsonPath: String
    unit: String
  }

  type Tariff {
    currency: String
    flatPrice: Float
    periods: [TariffPeriod!]
  }

  type TariffPeriod {
    "ISO weekdays, Monday = 1. Empty means every day."
    days: [Int!]
    from: String!
    to: String!
    price: Float!
    band: String
  }

  input AutomationConfigInput {
    enabled: Boolean
    dryRun: Boolean
    latitude: Float
    longitude: Float
    timezone: String
    fallbackAction: String
    tariff: TariffInput
    minOnMinutes: Int
    minOffMinutes: Int
    minChangeMinutes: Int
    maxCyclesPerHour: Int
    defaultHysteresis: Float
    overrideMinutes: Int
    mqtt: MqttConfigInput
  }

  input TariffInput {
    currency: String
    flatPrice: Float
    periods: [TariffPeriodInput!]
  }

  input TariffPeriodInput {
    days: [Int!]
    from: String!
    to: String!
    price: Float!
    band: String
  }

  input OverrideInput {
    minutes: Int
    reason: String
  }

  # ----------------------------------------------------------------- rules

  type AutomationRule {
    id: Int!
    name: String!
    enabled: Boolean!
    "Lower runs first."
    priority: Int!
    "Safety rules run even while the automation is paused, and bypass the guard rails."
    isSafety: Boolean!
    match: MatchMode!
    conditions: [RuleCondition!]!
    action: RuleAction!
    createdAt: String
    updatedAt: String
  }

  type RuleCondition {
    signal: String!
    "One of the operators the signal declares (see Automation.signals)."
    op: String!
    "Stringified; the engine casts it to the signal's type."
    value: String
    values: [String!]
    "Makes the threshold sticky while this rule is the one in charge: 'stop above X, resume below X - hysteresis'."
    hysteresis: Float
  }

  type RuleAction {
    type: ActionType!
    mode: MinerMode
  }

  input AutomationRuleInput {
    name: String
    enabled: Boolean
    priority: Int
    isSafety: Boolean
    match: MatchMode
    conditions: [RuleConditionInput!]
    action: RuleActionInput
  }

  input RuleConditionInput {
    signal: String!
    op: String!
    value: String
    values: [String!]
    hysteresis: Float
  }

  input RuleActionInput {
    type: ActionType!
    mode: MinerMode
  }

  # --------------------------------------------------------------- signals

  type SignalDescriptor {
    id: String!
    "The data type the engine casts to: number | boolean | time | string"
    type: String!
    "Which input the UI should render: number | time | date | weekday | boolean | enum | text"
    widget: String
    "Allowed values for enum/weekday widgets (e.g. the miner modes, or 1-7)."
    options: [String!]
    unit: String
    ops: [String!]!
    supportsHysteresis: Boolean!
  }

  type SignalValue {
    id: String!
    "Stringified; null when stale."
    value: String
    "The signal could not be read. A rule that uses it does not match."
    stale: Boolean!
    error: String
  }

  # ----------------------------------------------------------------- state

  type AutomationState {
    enabled: Boolean!
    dryRun: Boolean!
    decision: Decision
    guard: Guard
    miner: MinerAutomationState
    signals: [SignalValue!]!
    "Set only when this tick recorded a history event — pushed so the UI appends it live."
    event: AutomationEvent
  }

  type Decision {
    "off | mode:<mode> | none"
    target: String!
    ruleId: Int
    ruleName: String
    "safety | rule | fallback | override"
    reason: String!
  }

  type Guard {
    "False when nothing needs to change, or when a guard rail is holding it back."
    apply: Boolean!
    "start | stop | mode | null"
    changeType: String
    "override | min_on | min_off | min_change | max_cycles"
    blockedBy: String
    message: String
  }

  type MinerAutomationState {
    running: Boolean!
    mode: String
    lastChangeAt: String
    cyclesLastHour: Int!
    overrideUntil: String
  }

  # ---------------------------------------------------------------- events

  type AutomationEvent {
    id: Int!
    ruleId: Int
    ruleName: String
    decision: String!
    changeType: String
    applied: Boolean!
    dryRun: Boolean!
    blockedBy: String
    message: String
    "The values that produced the decision — a verdict is useless without them."
    signals: [SignalValue!]!
    createdAt: String
  }

  # --------------------------------------------------------------- outputs

  type AutomationConfigOutput {
    result: AutomationConfig
    error: Error
  }

  type AutomationRulesOutput {
    result: [AutomationRule!]
    error: Error
  }

  type AutomationRuleOutput {
    result: AutomationRule
    error: Error
  }

  type AutomationSignalsOutput {
    result: [SignalDescriptor!]
    error: Error
  }

  type AutomationStateOutput {
    result: AutomationState
    error: Error
  }

  type AutomationEventsOutput {
    result: [AutomationEvent!]
    error: Error
  }
`;
