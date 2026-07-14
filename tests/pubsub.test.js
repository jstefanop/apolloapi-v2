// tests/pubsub.test.js
// Tests for the PubSub singleton and TOPICS constants that drive GraphQL Subscriptions.

describe('TOPICS constants', () => {
  const TOPICS = require('../src/graphql/topics');

  const expected = ['MINER', 'NODE', 'MCU', 'SOLO', 'SERVICES', 'SETTINGS', 'AUTOMATION'];

  it('exports the expected topic keys', () => {
    for (const key of expected) {
      expect(TOPICS).toHaveProperty(key);
      expect(typeof TOPICS[key]).toBe('string');
    }
  });

  it('has no extra unexpected keys', () => {
    expect(Object.keys(TOPICS)).toHaveLength(expected.length);
  });

  it('topic values are non-empty strings', () => {
    for (const value of Object.values(TOPICS)) {
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe('PubSub singleton', () => {
  it('is the same instance on every require()', () => {
    const pubsubA = require('../src/graphql/pubsub');
    const pubsubB = require('../src/graphql/pubsub');
    expect(pubsubA).toBe(pubsubB);
  });

  it('exposes asyncIterator and publish methods', () => {
    const pubsub = require('../src/graphql/pubsub');
    expect(typeof pubsub.publish).toBe('function');
    expect(typeof pubsub.asyncIterator).toBe('function');
  });

  it('publish() delivers a payload to asyncIterator() on the same topic', async () => {
    const pubsub = require('../src/graphql/pubsub');
    const TOPICS = require('../src/graphql/topics');

    const topic = TOPICS.MCU; // use MCU to avoid interference with other tests
    const payload = { mcu: { result: { uptime: 42 }, error: null } };

    // Create iterator BEFORE publishing so it is registered
    const iterator = pubsub.asyncIterator([topic]);

    // Publish asynchronously so the iterator has time to register
    setImmediate(() => pubsub.publish(topic, payload));

    // Consume the first value
    const { value, done } = await iterator.next();

    expect(done).toBe(false);
    expect(value).toEqual(payload);

    // Clean up — return the iterator
    await iterator.return();
  });

  it('asyncIterator() does NOT deliver events published on a different topic', async () => {
    const pubsub = require('../src/graphql/pubsub');
    const TOPICS = require('../src/graphql/topics');

    const listenTopic   = TOPICS.SETTINGS;
    const publishTopic  = TOPICS.SOLO; // deliberately different

    const iterator = pubsub.asyncIterator([listenTopic]);

    // Publish to the wrong topic — should NOT reach the iterator
    pubsub.publish(publishTopic, { solo: { result: null, error: null } });

    // Publish to the correct topic — should arrive
    const expected = { settings: { key: 'value' } };
    setImmediate(() => pubsub.publish(listenTopic, expected));

    const { value } = await iterator.next();
    expect(value).toEqual(expected);

    await iterator.return();
  });
});
