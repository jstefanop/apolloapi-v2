const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Mqtt: MqttActions
  }

  type MqttActions {
    "Broker connection, output settings and input mappings (password never returned)."
    config: MqttConfigOutput! @auth

    updateConfig(input: MqttConfigInput!): MqttConfigOutput! @auth

    "One-off probe of the MQTT broker with the given (or stored) credentials."
    testConnection(input: MqttConfigInput!): MqttTestOutput! @auth

    "Subscribe to a wildcard for a few seconds and return the topics seen."
    discoverTopics(input: MqttConfigInput!, prefix: String, seconds: Int): MqttDiscoverOutput! @auth
  }

  type MqttConfigOutput {
    result: MqttConfig
    error: Error
  }

  type MqttConfig {
    enabled: Boolean
    host: String
    port: Int
    username: String
    tls: Boolean
    "Live connection state of the broker link."
    status: MqttStatus
    "Publishing the device state to the broker (Home Assistant discovery)."
    output: MqttOutput
    "Topic → signal mappings; each becomes an input.<name> number signal for the automation."
    inputs: [MqttInput!]
  }

  type MqttStatus {
    connected: Boolean!
    error: String
  }

  type MqttOutput {
    "Publish the device state to the broker and announce it to Home Assistant."
    enabled: Boolean
    "Also expose command topics so Home Assistant can start/stop and set the mode."
    control: Boolean
    "Stable id used for the HA device and topic prefix (apollo/<deviceId>/…)."
    deviceId: String
  }

  type MqttInput {
    name: String!
    topic: String!
    "Optional dot-path into a JSON payload (e.g. 'solar.surplus')."
    jsonPath: String
    unit: String
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
    "Home Assistant discovery: friendly name of a resolved sensor value."
    name: String
    "Home Assistant discovery: unit of a resolved sensor value."
    unit: String
    "Home Assistant discovery: the single value path resolved from a sensor config."
    jsonPath: String
    "The current reading, if the topic has published one during the scan."
    value: String
  }

  input MqttConfigInput {
    enabled: Boolean
    host: String
    port: Int
    username: String
    password: String
    tls: Boolean
    inputs: [MqttInputInput!]
    output: MqttOutputInput
  }

  input MqttOutputInput {
    enabled: Boolean
    control: Boolean
  }

  input MqttInputInput {
    name: String!
    topic: String!
    jsonPath: String
    unit: String
  }
`;
