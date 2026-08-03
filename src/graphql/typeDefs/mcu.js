const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Mcu: McuActions
  }

  type McuActions {
    stats: McuStatsOutput! @auth

    # --- WiFi (reads) ---
    # Every wifi radio on the device, labelled built-in or usb. A picker is only
    # worth showing when there is more than one, which is the exception.
    wifiInterfaces: McuWifiInterfacesOutput! @auth
    # What the chosen radio is attached to right now. Omitting ifname asks about
    # the one carrying the default route.
    wifiStatus(ifname: String): McuWifiStatusOutput! @auth
    # Scanning is per radio: two adapters report different signals for the same
    # network, so a merged list could not say which one can reach it.
    wifiNetworks(ifname: String!): McuWifiNetworksOutput! @auth
    wifiSaved: McuWifiSavedOutput! @auth

    wifiScan: McuWifiScanOutput!
      @auth
      @deprecated(
        reason: "replaced by wifiNetworks(ifname), which reports the radio, the band, hidden and open networks; this shape only serves pre-2.1.4 UI bundles"
      )
    wifiConnect(input: McuWifiConnectInput!): McuWifiConnectOutput!
      @auth
      @deprecated(
        reason: "wifiConnect is a Mutation (Mutation.Mcu.wifiConnect); a query re-executes on re-render, and this one carries a passphrase"
      )
    wifiDisconnect: McuWifiDisconnectOutput!
      @auth
      @deprecated(
        reason: "wifiDisconnect is a Mutation (Mutation.Mcu.wifiDisconnect), and it now only disconnects — use Mutation.Mcu.wifiForget to delete a saved network"
      )
    # reboot/shutdown/update: deprecated aliases for pre-mutation UI bundles —
    # see the NodeActions aliases for the rationale.
    reboot: EmptyOutput!
      @auth
      @deprecated(
        reason: "reboot is a Mutation (Mutation.Mcu.reboot); this query alias only serves pre-2.1.4 UI bundles"
      )
    shutdown: EmptyOutput!
      @auth
      @deprecated(
        reason: "shutdown is a Mutation (Mutation.Mcu.shutdown); this query alias only serves pre-2.1.4 UI bundles"
      )
    version: McuAppVersionOutput! @auth
    update: EmptyOutput!
      @auth
      @deprecated(
        reason: "update is a Mutation (Mutation.Mcu.update); this query alias only serves pre-2.1.4 UI bundles"
      )
    updateProgress: McuUpdateProgressOutput! @auth
  }

  # Side-effectful actions must not be queries — Apollo Client re-executes
  # queries on re-render (see typeDefs/node.js), and a phantom re-fire here
  # reboots the device or launches a second concurrent update.
  extend type Mutation {
    Mcu: McuMutations
  }

  type McuMutations {
    reboot: EmptyOutput! @auth
    shutdown: EmptyOutput! @auth
    update: EmptyOutput! @auth

    # Joining a network is not idempotent and carries a secret: a query would be
    # re-executed on re-render, re-sending the passphrase.
    wifiConnect(input: McuWifiConnectInput!): McuWifiConnectOutput! @auth
    # Drops the radio and KEEPS the saved profile, so reconnecting does not mean
    # typing the passphrase again.
    wifiDisconnect(ifname: String!): EmptyOutput! @auth
    # Deletes ONE saved network, addressed by uuid. The operation this splits
    # away from wifiDisconnect used to delete every profile it could match.
    wifiForget(uuid: String!): EmptyOutput! @auth
  }

  type McuStatsOutput {
    result: McuStatsResult
    error: Error
  }

  type McuStatsResult {
    stats: McuStats!
  }

  type McuStats {
    timestamp: String!
    hostname: String
    operatingSystem: String
    uptime: String
    loadAverage: String
    architecture: String
    temperature: Int
    minerTemperature: Float
    minerFanSpeed: Int
    bfgminerLog: String
    activeWifi: String
    network: [NetworkStats!]
    memory: MemoryStats
    cpu: CpuStats
    disks: [DiskStats!]
  }

  type MemoryStats {
    total: Float
    available: Float
    used: Float
    cache: Float
    swap: Float
  }

  type CpuStats {
    threads: Int
    usedPercent: Float
  }

  type NetworkStats {
    name: String
    address: String
    mac: String
  }

  type DiskStats {
    total: Float
    used: Float
    mountPoint: String
  }

  type McuWifiScanOutput {
    result: McuWifiScanResult
    error: Error
  }

  type McuWifiScanResult {
    wifiScan: [McuWifiScan]
  }

  type McuWifiScan {
    ssid: String
    mode: String
    channel: Int
    rate: Int
    signal: Int
    security: String
    inuse: Boolean
  }

  type McuWifiInterfacesOutput {
    result: McuWifiInterfacesResult
    error: Error
  }

  type McuWifiInterfacesResult {
    interfaces: [McuWifiInterface]
    # Which one the UI should preselect: the radio with the default route, not
    # simply the built-in — on an Apollo II the built-in may serve something
    # else entirely while a USB dongle carries the LAN.
    preferred: String
  }

  type McuWifiInterface {
    device: String!
    kind: String!          # builtin | usb | unknown
    state: String
    connected: Boolean!
    connection: String     # the network it is on, if any
    carriesDefaultRoute: Boolean!
  }

  type McuWifiStatusOutput {
    result: McuWifiStatus
    error: Error
  }

  type McuWifiStatus {
    connected: Boolean!
    ssid: String
    interface: String
    kind: String
    carriesDefaultRoute: Boolean
    ipAddress: String
  }

  type McuWifiNetworksOutput {
    result: McuWifiNetworksResult
    error: Error
  }

  type McuWifiNetworksResult {
    networks: [McuWifiNetwork]
  }

  type McuWifiNetwork {
    # Null when the network hides its name; hidden says so explicitly rather
    # than leaving a blank row in the list.
    ssid: String
    hidden: Boolean!
    bssid: String
    mode: String
    channel: Int
    frequency: Int
    band: String           # 2.4 | 5 | 6
    bands: [String]        # every band this name was seen on
    signal: Int!
    # A LIST — nmcli reports "WPA2 WPA3". Empty means open, and open says it
    # outright so the UI does not ask for a passphrase that does not exist.
    security: [String]
    open: Boolean!
    active: Boolean!
  }

  type McuWifiSavedOutput {
    result: McuWifiSavedResult
    error: Error
  }

  type McuWifiSavedResult {
    networks: [McuWifiSavedNetwork]
  }

  type McuWifiSavedNetwork {
    # The profile's id, which is NOT the network: netplan calls the profile for
    # the network Home "netplan-wlan0-Home". Show ssid, match on ssid.
    name: String!
    ssid: String
    uuid: String!
    device: String
    active: Boolean!
  }

  input McuWifiConnectInput {
    ssid: String!
    passphrase: String
    # Which radio to join with. Optional so the deprecated query alias, which
    # never had it, keeps working: it falls back to the preferred interface.
    ifname: String
    hidden: Boolean
  }

  type McuWifiConnectOutput {
    result: McuWifiConnectResult
    error: Error
  }

  type McuWifiConnectResult {
    address: String!
  }

  type McuWifiDisconnectOutput {
    error: Error
  }

  type McuAppVersionOutput {
    result: String
    error: Error
  }

  type McuUpdateProgressOutput {
    result: McuUpdateProgressResult
    error: Error
  }

  type McuUpdateProgressResult {
    value: Int
  }
`;