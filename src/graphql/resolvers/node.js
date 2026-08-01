// One implementation for the mutation AND its deprecated query alias: the alias
// exists only so pre-mutation UI bundles keep working across an update, and it
// must not drift from the real thing.
const format = async (_, __, { services }) => {
  try {
    await services.node.format();
    return { error: null };
  } catch (error) {
    return { error: { message: error.message } };
  }
};

// The alias must not re-arm the bug the mutation move fixed: Apollo re-executes
// queries on re-render, and a stale tab's phantom re-fire landing after the
// current format finishes (worker lock released) would wipe the fresh disk with
// no click. So the query path is single-shot per API process: the first
// confirmed launch spends it and every later call is refused — a refused or
// failed launch does not spend it, so a real retry still works. Reloading the
// page gets the current bundle, whose mutation path has no such limit.
// start/stop share the mutation-plus-alias shape (their query fields fired the
// same re-execution hazard), but not the latch: a phantom re-fired start/stop is
// recoverable, and refusing repeats would break a stale bundle's node controls.
const start = async (_, __, { services }) => {
  try {
    await services.node.start();
    return { error: null };
  } catch (error) {
    return { error: { message: error.message } };
  }
};

const stop = async (_, __, { services }) => {
  try {
    await services.node.stop();
    return { error: null };
  } catch (error) {
    return { error: { message: error.message } };
  }
};

let formatAliasSpent = false;
const formatQueryAlias = async (...args) => {
  if (formatAliasSpent) {
    return {
      error: {
        message:
          'Format already launched from an outdated page. Reload the page to run another format.'
      }
    };
  }
  const result = await format(...args);
  if (!result.error) formatAliasSpent = true;
  return result;
};

module.exports = {
  Query: {
    Node: () => ({})
  },

  Mutation: {
    Node: () => ({})
  },

  NodeMutations: {
    start,
    stop,
    format
  },

  NodeActions: {
    // Deprecated aliases — see typeDefs/node.js.
    format: formatQueryAlias,
    start,
    stop,

    stats: async (_, __, { services }) => {
      try {
        const result = await services.node.getStats();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    conf: async (_, __, { services }) => {
      try {
        const result = await services.node.getConf();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    formatProgress: async (_, __, { services }) => {
      try {
        const result = await services.node.getFormatProgress();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    online: async (_, __, { services }) => {
      try {
        const result = await services.node.checkOnline();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    recentBlocks: async (_, { count = 15 }, { services }) => {
      try {
        // Read from database instead of RPC
        const blocks = await services.node.getRecentBlocksFromDB(count);
        
        return { 
          result: { 
            blocks,
            error: null // No error if DB read successful
          }, 
          error: null 
        };
      } catch (error) {
        return { 
          result: null, 
          error: { message: error.message } 
        };
      }
    }
  }
};