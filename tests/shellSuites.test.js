// child_process is mocked for the whole suite (tests/setup.js); these need the
// real one — the point is to run the scripts.
const { spawnSync } = jest.requireActual('child_process');
const path = require('path');

// The bash suites under tests/ were only ever run by hand, which is the same as
// not running them: the launcher logic they cover (node storage states, the
// datadir after a full disk) is exactly what no jest test can reach. Running
// them here puts them on the same footing as everything else.
const suites = ['node_storage.test.sh', 'node_datadir.test.sh', 'ckpool_scripts.test.sh'];

describe.each(suites)('%s', (suite) => {
  it('passes', () => {
    const r = spawnSync('bash', [path.join(__dirname, suite)], { encoding: 'utf8' });
    if (r.status !== 0) {
      // Surface the suite's own report, not just "exit 1".
      throw new Error(`${suite} failed:\n${r.stdout}\n${r.stderr}`);
    }
    expect(r.stdout).toMatch(/0 failed/);
  });
});
