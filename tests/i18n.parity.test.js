const path = require('path');
const { readFileSync } = require('fs');

// Locale files live in the UI submodule; the backend test just reads them so we
// don't need a separate UI test runner to guard translation key parity.
const LOCALES_DIR = path.join(__dirname, '..', 'apolloui-v2', 'src', 'locales');
const LANGS = ['en', 'it', 'de', 'es'];

const flatten = (obj, prefix = '') =>
  Object.entries(obj).reduce((acc, [k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(acc, flatten(v, `${prefix}${k}.`));
    } else {
      acc[`${prefix}${k}`] = v;
    }
    return acc;
  }, {});

const loadKeys = (lang) => {
  const raw = readFileSync(path.join(LOCALES_DIR, `${lang}.json`), 'utf8');
  return new Set(Object.keys(flatten(JSON.parse(raw))));
};

describe('i18n locale parity', () => {
  const keys = {};
  LANGS.forEach((l) => (keys[l] = loadKeys(l)));

  it('all locale files are valid JSON with keys', () => {
    LANGS.forEach((l) => expect(keys[l].size).toBeGreaterThan(0));
  });

  // Reference set = English. Every other locale must have exactly the same keys.
  LANGS.filter((l) => l !== 'en').forEach((lang) => {
    it(`${lang}.json has the same keys as en.json`, () => {
      const missing = [...keys.en].filter((k) => !keys[lang].has(k));
      const extra = [...keys[lang]].filter((k) => !keys.en.has(k));
      expect({ lang, missing, extra }).toEqual({ lang, missing: [], extra: [] });
    });
  });
});
