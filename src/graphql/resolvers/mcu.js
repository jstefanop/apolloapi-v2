// One implementation each for the mutation AND its deprecated query alias (see
// typeDefs/mcu.js): the aliases only serve pre-mutation UI bundles and must not
// drift from the real thing.
const reboot = async (_, __, { services }) => {
  try {
    await services.mcu.reboot();
    return { error: null };
  } catch (error) {
    return { error: { message: error.message } };
  }
};

const shutdown = async (_, __, { services }) => {
  try {
    await services.mcu.shutdown();
    return { error: null };
  } catch (error) {
    return { error: { message: error.message } };
  }
};

const update = async (_, __, { services }) => {
  try {
    await services.mcu.update();
    return { error: null };
  } catch (error) {
    return { error: { message: error.message } };
  }
};


// --- WiFi -------------------------------------------------------------------
// All of these go through services.wifi, which discovers the radio instead of
// assuming wlan0 and never hands nmcli a shell string.

// Which radio to act on when the caller did not say. The deprecated query
// aliases never had an ifname, so they land here too.
const resolveIfname = async (services, ifname) => {
  if (ifname) return ifname;
  const interfaces = await services.wifi.listInterfaces();
  return services.wifi.preferredInterface(interfaces)?.device || null;
};

const wifiConnectImpl = async (_, { input }, { services }) => {
  try {
    const ifname = await resolveIfname(services, input.ifname);
    if (!ifname) throw new Error('no-wifi-interface');
    const status = await services.wifi.connect(ifname, input.ssid, input.passphrase, {
      hidden: !!input.hidden,
      // `??`, not `||`: "" is the caller asking to clear a pinned band, and null
      // is them saying nothing about it. Collapsing the two made every reconnect
      // clear a band the user had pinned in an earlier session.
      band: input.band ?? null,
    });
    // The legacy shape promised { address }; the new one carries the whole
    // status, and address stays so old bundles keep reading it.
    return { result: { ...status, address: status.ipAddress }, error: null };
  } catch (error) {
    // reason is the classified cause (bad-passphrase, ssid-not-found, timeout);
    // message alone would surface nmcli raw text.
    return { result: null, error: { message: error.reason || error.message } };
  }
};

module.exports = {
  Query: {
    Mcu: () => ({})
  },

  Mutation: {
    Mcu: () => ({})
  },

  McuMutations: {
    wifiConnect: wifiConnectImpl,

    wifiDisconnect: async (_, { ifname }, { services }) => {
      try {
        await services.wifi.disconnect(ifname);
        return { error: null };
      } catch (error) {
        // What the UI is told is classified; what nmcli said is kept in the
        // journal, because it is the only account of WHY and the device is
        // rarely in the room.
        console.error(`[wifi] disconnect ${ifname} failed: ${error.output || error.message}`);
        return { error: { message: error.reason || error.message } };
      }
    },

    wifiForget: async (_, { uuid }, { services }) => {
      try {
        await services.wifi.forget(uuid);
        return { error: null };
      } catch (error) {
        console.error(`[wifi] forget ${uuid} failed: ${error.output || error.message}`);
        return { error: { message: error.reason || error.message } };
      }
    },

    reboot,
    shutdown,
    update
  },

  McuActions: {
    // Deprecated aliases — see typeDefs/mcu.js.
    reboot,
    shutdown,
    update,
    stats: async (_, __, { services }) => {
      try {
        const result = await services.mcu.getStats();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    wifiInterfaces: async (_, __, { services }) => {
      try {
        const interfaces = await services.wifi.listInterfaces();
        const preferred = services.wifi.preferredInterface(interfaces);
        return { result: { interfaces, preferred: preferred?.device || null }, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    wifiStatus: async (_, { ifname }, { services }) => {
      try {
        const device = await resolveIfname(services, ifname);
        if (!device) return { result: { connected: false }, error: null };
        return { result: await services.wifi.status(device), error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    wifiNetworks: async (_, { ifname }, { services }) => {
      try {
        return { result: { networks: await services.wifi.scan(ifname) }, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    wifiSaved: async (_, __, { services }) => {
      try {
        return { result: { networks: await services.wifi.savedNetworks() }, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    // Deprecated: the old flat shape, served from the new scanner so the bash
    // parser can go. Hidden networks keep their historical empty ssid here.
    wifiScan: async (_, __, { services }) => {
      try {
        const device = await resolveIfname(services, null);
        const networks = device ? await services.wifi.scan(device) : [];
        return {
          result: {
            wifiScan: networks.map((n) => ({
              ssid: n.ssid ?? '',
              mode: n.mode,
              channel: n.channel,
              rate: null, // not requested any more; the new shape has band instead
              signal: n.signal,
              security: (n.security || []).join(' '),
              inuse: n.active,
            })),
          },
          error: null,
        };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    // Deprecated alias — same implementation as the mutation.
    wifiConnect: wifiConnectImpl,

    // Deprecated alias. It now DISCONNECTS only: the old behaviour deleted every
    // saved profile it could match, which on an Apollo II takes down whatever
    // the built-in radio serves. Forgetting is Mutation.Mcu.wifiForget.
    wifiDisconnect: async (_, __, { services }) => {
      try {
        const device = await resolveIfname(services, null);
        if (!device) throw new Error('no-wifi-interface');
        await services.wifi.disconnect(device);
        return { error: null };
      } catch (error) {
        return { error: { message: error.reason || error.message } };
      }
    },

    version: async (_, __, { services }) => {
      try {
        const result = await services.mcu.getVersion();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    updateProgress: async (_, __, { services }) => {
      try {
        const result = await services.mcu.getUpdateProgress();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    }
  }
};