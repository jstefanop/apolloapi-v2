// Dev fake for the Bitcoin node, mirroring devMinerService / devSoloService.
// In NODE_ENV=development, node.js._createRpcClient() returns an in-process fake
// client so the Node pages (stats, online, recent blocks) render without a real
// bitcoind. Reusable for local UI development and for the E2E fake-device stack.

const TIP = Number(process.env.FAKE_TIP_HEIGHT || 956365);
const NOW = () => Math.floor(Date.now() / 1000);

// Deterministic 64-hex "hash" from a seed.
const hash = (seed) => {
  let s = String(seed);
  let out = '';
  for (let i = 0; i < 64; i++) {
    s = (Array.from(s).reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 7 + i)).toString(16);
    out += s[s.length - 1];
  }
  return out.slice(0, 64);
};

// Coinbase scriptSig hex with an embedded ASCII pool tag (for pool detection).
const coinbaseHex = (height) => {
  const ascii = Buffer.from('/FutureBit E2E/', 'utf8').toString('hex');
  return `03${height.toString(16).padStart(6, '0')}${ascii}00000000`;
};

const block = (height) => ({
  hash: hash(`block-${height}`),
  height,
  time: NOW() - (TIP - height) * 600,
  mediantime: NOW() - (TIP - height) * 600 - 300,
  size: 1_500_000,
  weight: 3_990_000,
  nTx: 2800 + (height % 500),
  tx: [hash(`coinbase-${height}`)],
  previousblockhash: hash(`block-${height - 1}`),
});

const handlers = {
  getblockchaininfo: () => ({
    chain: 'main',
    blocks: TIP,
    headers: TIP,
    bestblockhash: hash(`block-${TIP}`),
    difficulty: 110000000000000,
    mediantime: NOW() - 300,
    verificationprogress: 0.9999995,
    initialblockdownload: false,
    size_on_disk: 856000000000,
    pruned: false,
  }),
  getblockcount: () => TIP,
  getconnectioncount: () => 60,
  getmininginfo: () => ({ blocks: TIP, difficulty: 110000000000000, networkhashps: 6.5e20 }),
  getnetworkinfo: () => ({
    version: 280100,
    subversion: '/Satoshi:28.1.0/',
    connections: 60,
    connections_in: 52,
    connections_out: 8,
    localaddresses: [],
  }),
  getpeerinfo: () =>
    Array.from({ length: 8 }, (_, i) => ({
      id: i,
      addr: `203.0.113.${10 + i}:8333`,
      subver: '/Satoshi:28.1.0/',
      inbound: i % 3 !== 0,
      startingheight: TIP,
    })),
  getblockhash: ([height]) => hash(`block-${height}`),
  getblock: () => block(TIP),
  getblockheader: () => ({ ...block(TIP - 1) }),
  getblockstats: ([height]) => ({
    height,
    total_size: 1_500_000,
    total_weight: 3_990_000,
    totalfee: 12500000,
    subsidy: 312500000,
    avgfeerate: 8,
    txs: 2800,
  }),
  getrawtransaction: () => ({
    txid: hash('coinbase'),
    vin: [{ coinbase: coinbaseHex(TIP) }],
    vout: [{ value: 3.125 }, { value: 0.125 }],
  }),
  uptime: () => 123456,
};

const dispatch = (req) => {
  const id = req.id ?? null;
  const fn = handlers[req.method];
  if (!fn) return { result: null, error: { code: -32601, message: `Method not found: ${req.method}` }, id };
  try {
    return { result: fn(req.params || []), error: null, id };
  } catch (e) {
    return { result: null, error: { code: -1, message: e.message }, id };
  }
};

// axios-compatible client: post(path, body) -> { data: <single obj | array> }
const createFakeRpcClient = () => ({
  post: async (_path, body) => ({
    data: Array.isArray(body) ? body.map(dispatch) : dispatch(body),
  }),
});

module.exports = { createFakeRpcClient };
