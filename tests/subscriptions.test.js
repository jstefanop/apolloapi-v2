// tests/subscriptions.test.js
// Unit tests for GraphQL Subscription resolvers.
// Verifies that each resolver calls asyncIterator with the correct topic
// and that the resolve() function extracts the correct field from the payload.

describe('Subscription resolvers', () => {
  let resolvers;
  let pubsub;
  let TOPICS;
  let asyncIteratorSpy;

  beforeEach(() => {
    // Fresh require so that the spy is applied consistently
    jest.resetModules();

    pubsub = require('../src/graphql/pubsub');
    TOPICS = require('../src/graphql/topics');

    asyncIteratorSpy = jest
      .spyOn(pubsub, 'asyncIterator')
      .mockReturnValue('MOCK_ITERATOR');

    resolvers = require('../src/graphql/resolvers/subscriptions');
  });

  afterEach(() => {
    asyncIteratorSpy.mockRestore();
  });

  const fields = [
    { name: 'miner',    topic: 'MINER',    payloadKey: 'miner'    },
    { name: 'node',     topic: 'NODE',     payloadKey: 'node'     },
    { name: 'mcu',      topic: 'MCU',      payloadKey: 'mcu'      },
    { name: 'solo',     topic: 'SOLO',     payloadKey: 'solo'     },
    { name: 'services', topic: 'SERVICES', payloadKey: 'services' },
    { name: 'settings', topic: 'SETTINGS', payloadKey: 'settings' },
  ];

  describe('subscribe() calls asyncIterator with the correct TOPIC', () => {
    for (const { name, topic } of fields) {
      it(`${name}: calls asyncIterator([TOPICS.${topic}])`, () => {
        const result = resolvers.Subscription[name].subscribe();

        expect(asyncIteratorSpy).toHaveBeenCalledWith([TOPICS[topic]]);
        expect(result).toBe('MOCK_ITERATOR');
      });
    }
  });

  describe('resolve() extracts the correct field from the payload', () => {
    for (const { name, payloadKey } of fields) {
      it(`${name}: returns payload.${payloadKey}`, () => {
        const mockData = { result: { some: 'data' }, error: null };
        const payload = { [payloadKey]: mockData };

        const result = resolvers.Subscription[name].resolve(payload);

        expect(result).toBe(mockData);
      });
    }
  });

  describe('resolve() handles missing payload fields gracefully', () => {
    for (const { name, payloadKey } of fields) {
      it(`${name}: returns undefined when payload.${payloadKey} is absent`, () => {
        const result = resolvers.Subscription[name].resolve({});
        expect(result).toBeUndefined();
      });
    }
  });

  describe('Subscription object structure', () => {
    it('exports exactly the 6 expected subscription fields', () => {
      const keys = Object.keys(resolvers.Subscription);
      expect(keys).toHaveLength(6);
      expect(keys).toEqual(
        expect.arrayContaining(['miner', 'node', 'mcu', 'solo', 'services', 'settings'])
      );
    });

    it('each field has both subscribe and resolve functions', () => {
      for (const key of Object.keys(resolvers.Subscription)) {
        expect(typeof resolvers.Subscription[key].subscribe).toBe('function');
        expect(typeof resolvers.Subscription[key].resolve).toBe('function');
      }
    });
  });
});
