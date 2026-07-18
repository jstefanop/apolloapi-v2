const path = require('path');
const fs = require('fs');
const { parse, validate, visit } = require('graphql');
const schema = require('../src/graphql/schema');

// Contract test: every GraphQL document the UI ships (apolloui-v2/src/graphql/*)
// must validate against the backend schema. Catches server field drift like the
// "Cannot query field mindiff" class of bug before it reaches a device.
//
// Handles the UI's realities:
//  - gql`` templates with ${FRAGMENT} interpolation, incl. fragments that
//    interpolate other fragments (resolved iteratively).
//  - duplicate fragment definitions after inlining (deduped by name).
//  - Apollo Client local-only fields/directives (@client) which are NOT part of
//    the server schema by design (stripped before validation).

const UI_DIR_CANDIDATES = [
  path.join(__dirname, '..', 'apolloui-v2'),
  path.join(__dirname, '..', '..', 'apolloui-v2'),
];
const UI_DIR = UI_DIR_CANDIDATES.find((candidate) =>
  fs.existsSync(path.join(candidate, 'src', 'graphql'))
);
if (!UI_DIR) throw new Error('Could not locate the apolloui-v2 repository');
const GQL_DIR = path.join(UI_DIR, 'src', 'graphql');
const FRAG_DIR = path.join(GQL_DIR, 'fragments');

const extractGqlBlocks = (src) => {
  const blocks = [];
  const re = /gql`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(src)) !== null) blocks.push(m[1]);
  return blocks;
};

const buildFragmentMap = () => {
  const map = {};
  for (const file of fs.readdirSync(FRAG_DIR).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(FRAG_DIR, file), 'utf8');
    const nameMatch = src.match(/export\s+const\s+([A-Za-z0-9_]+)\s*=\s*gql`/);
    const blocks = extractGqlBlocks(src);
    if (nameMatch && blocks.length) map[nameMatch[1]] = blocks[0];
  }
  return map;
};

// Resolve ${FRAGMENT} interpolations iteratively (fragments can interpolate
// other fragments), until the text is stable.
const resolveInterpolations = (body, fragMap) => {
  let out = body;
  for (let i = 0; i < 10 && out.includes('${'); i++) {
    out = out.replace(/\$\{([A-Za-z0-9_]+)\}/g, (whole, name) =>
      fragMap[name] != null ? fragMap[name] : whole
    );
  }
  return out;
};

// Remove duplicate fragment definitions (same name) left by inlining.
const dedupeFragments = (doc) => {
  const seen = new Set();
  return {
    ...doc,
    definitions: doc.definitions.filter((d) => {
      if (d.kind !== 'FragmentDefinition') return true;
      if (seen.has(d.name.value)) return false;
      seen.add(d.name.value);
      return true;
    }),
  };
};

// Drop client-only selections/directives (@client) — not part of the server schema.
const stripClient = (doc) =>
  visit(doc, {
    Field(node) {
      if (node.directives && node.directives.some((d) => d.name.value === 'client')) return null;
    },
    Directive(node) {
      if (node.name.value === 'client') return null;
    },
  });

const collectOperations = (fragMap) => {
  const ops = [];
  for (const file of fs.readdirSync(GQL_DIR).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(GQL_DIR, file), 'utf8');
    extractGqlBlocks(src).forEach((body, i) => {
      const resolved = resolveInterpolations(body, fragMap);
      if (!/\b(query|mutation|subscription)\b/i.test(resolved)) return; // pure fragment file
      ops.push({ file: `${file}#${i}`, body: resolved });
    });
  }
  return ops;
};

describe('UI GraphQL documents ↔ backend schema contract', () => {
  const fragMap = buildFragmentMap();
  const ops = collectOperations(fragMap);

  it('finds UI operations to validate', () => {
    expect(ops.length).toBeGreaterThan(0);
  });

  it('every UI operation validates against the backend schema', () => {
    const failures = [];
    for (const op of ops) {
      let doc;
      try {
        doc = parse(op.body);
      } catch (e) {
        failures.push(`${op.file}: parse error: ${e.message}`);
        continue;
      }
      doc = stripClient(dedupeFragments(doc));
      const errors = validate(schema, doc);
      if (errors.length) failures.push(`${op.file}: ${errors.map((e) => e.message).join(' | ')}`);
    }
    expect(failures).toEqual([]);
  });
});
