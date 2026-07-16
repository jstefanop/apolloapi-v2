const client = require('../src/services/mqtt/client');

describe('mqtt browse — Home Assistant discovery resolution', () => {
  describe('jsonPath from value_template', () => {
    const cases = [
      ['{{ value_json.total_yield }}', 'total_yield'],
      ['{{ value_json.battery.soc }}', 'battery.soc'],
      ["{{ value_json['total_yield'] }}", 'total_yield'],
      ["{{ value_json['a']['b'] }}", 'a.b'],
      ['{{ value_json.power | float }}', 'power'],
      ['{{ value | float }}', null], // no value_json field
      ['', null],
      [null, null],
    ];
    it.each(cases)('%s -> %s', (tpl, expected) => {
      expect(client._jsonPathFromTemplate(tpl)).toBe(expected);
    });
  });

  describe('resolving a sensor config to its value', () => {
    const cfg = JSON.stringify({
      name: 'Total Yield',
      state_topic: 'sun2000/state',
      value_template: '{{ value_json.total_yield }}',
      unit_of_measurement: 'kWh',
      device: { name: 'SUN2000 6KTL-L1' },
    });

    it('maps the config topic to the real state topic and field', () => {
      const r = client._resolveHaSensorConfig('homeassistant/sensor/sun2000_6ktl_l1/total_yield/config', cfg);
      expect(r).toEqual({
        topic: 'sun2000/state',
        jsonPath: 'total_yield',
        name: 'Total Yield',
        unit: 'kWh',
        sample: null,
        jsonPaths: null,
      });
    });

    it('ignores non-config topics', () => {
      expect(client._resolveHaSensorConfig('sun2000/state', cfg)).toBeNull();
    });

    it('ignores non-sensor discovery (switch/binary_sensor/…)', () => {
      expect(client._resolveHaSensorConfig('homeassistant/switch/x/miner/config', cfg)).toBeNull();
    });

    it('ignores a config without a state topic', () => {
      const noState = JSON.stringify({ name: 'X', value_template: '{{ value_json.x }}' });
      expect(client._resolveHaSensorConfig('homeassistant/sensor/x/y/config', noState)).toBeNull();
    });

    it('ignores an unparseable payload', () => {
      expect(client._resolveHaSensorConfig('homeassistant/sensor/x/y/config', 'not json')).toBeNull();
    });
  });

  describe('current value from the state payload', () => {
    const state = JSON.stringify({ total_yield: 1234.5, battery: { soc: 87 } });

    it('pulls the field out of a JSON state payload', () => {
      expect(client._currentValue(state, 'total_yield')).toBe('1234.5');
      expect(client._currentValue(state, 'battery.soc')).toBe('87');
    });

    it('returns the raw payload when there is no path', () => {
      expect(client._currentValue('online', null)).toBe('online');
    });

    it('is null when nothing has been published yet', () => {
      expect(client._currentValue(undefined, 'total_yield')).toBeNull();
    });

    it('is null when the field is absent', () => {
      expect(client._currentValue(state, 'missing')).toBeNull();
    });
  });
});
