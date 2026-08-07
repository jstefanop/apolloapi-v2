// tests/helpers/fakeSpawn.js
// Shared scaffolding for suites that exercise a spawn-based launcher service
// (node format, mcu update, the next one): one fake child_process child plus
// the console spies, built in one place so a fix to the fake — a missing
// `kill`, a `pid` — lands in every suite at once.
//
// Each suite still declares its own
//   jest.mock('child_process', () => ({ spawn: jest.fn(), exec: jest.fn() }));
// jest.mock is hoisted per test file and cannot live here.
//
// jest.config has resetMocks:true, so the spawn implementation is wiped before
// every test — installFakeSpawn registers a beforeEach that re-installs it (and
// silences the service's console noise). It returns an accessor rather than the
// child itself: a fresh child is minted per spawn call, so a plain reference
// captured at install time would go stale.
const { EventEmitter } = require('events');

const makeChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // Watchdogs call it, and a real one may not be answered: killing does not
  // reap a process stuck in uninterruptible I/O, so nothing here emits 'close'
  // on its own. A service that only settles on the death would hang forever.
  child.kill = jest.fn();
  return child;
};

const installFakeSpawn = (spawn) => {
  let child;
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    spawn.mockImplementation(() => {
      child = makeChild();
      return child;
    });
  });
  return () => child;
};

module.exports = { installFakeSpawn, makeChild };
