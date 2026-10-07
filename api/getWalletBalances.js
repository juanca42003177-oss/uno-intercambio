// getWalletBalances — todos los saldos de una wallet en un request (Vercel, gratis)
const { rpcBatch, hexToBigInt } = require('./_rpc');

const WETH_ADDR = '0x4200000000000000000000000000000000000006';
const TOKENS = {
  USDC:     { addr: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', decimals: 6 },
  WLD:      { addr: '0x2cFc85d8E48F8EAB294be644d9E25C3030863003', decimals: 18 },
  HUB:      { addr: '0xd469fda5d9522a093760902e9be51e0c5d822d26', decimals: 18 },
  ORB:      { addr: '0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB', decimals: 18 },
  uSOL:     { addr: '0x9B8Df6E244526ab5F6e6400d331DB28C8fdDdb55', decimals: 18 },
  WBTC:     { addr: '0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3', decimals: 8 },
  DNA:      { addr: '0xed49fe44fd4249a09843c2ba4bba7e50beca7113', decimals: 18 },
  ORO:      { addr: '0xcd1e32b86953d79a6ac58e813d2ea7a1790cab63', decimals: 18 },
  SUSHI:    { addr: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38', decimals: 18 },
  DIAMANTE: { addr: '0x2ba918fec90Ca7AaC5753a2551593470815866e6', decimals: 18 },
  PVPB:     { addr: '0xBC69990A060cC5AF40942f579BdF82A69A9CFf93', decimals: 18 },
  TPF:      { addr: '0x834a73c0a83F3BCe349A116FFB2A4c2d1C651E45', decimals: 18 },
  AXO:      { addr: '0x249820C0479D0A7feE6A2A3a14583267550F3caF', decimals: 18 },
  WDD:      { addr: '0xEdE54d9c024ee80C85ec0a75eD2d8774c7Fbac9B', decimals: 18 },
  CHAD:     { addr: '0x50723A159ba02A1ADA4d7E1A32835f7ff1F1bE89', decimals: 18 },
  uDOGE:    { addr: '0x12E96C2BFEA6E835CF8Dd38a5834fa61Cf723736', decimals: 18 },
  uXRP:     { addr: '0x2615a94df961278DcbC41Fb0a54fEc5f10a693aE', decimals: 18 },
};

module.exports = async (req, res) => {
  try {
    const address = String((req.body && req.body.address) || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Dirección inválida' });
    }
    const calls = [];
    const idToSym = {};
    let id = 1;
    for (const [sym, cfg] of Object.entries(TOKENS)) {
      calls.push({ to: cfg.addr, data: '0x70a08231' + address.slice(2).padStart(64, '0') });
      idToSym[id] = { sym, decimals: cfg.decimals };
      id++;
    }
    calls.push({ to: WETH_ADDR, data: '0x70a08231' + address.slice(2).padStart(64, '0') });
    idToSym[id] = { sym: 'WETH', decimals: 18 };

    const results = await rpcBatch(calls);
    const balances = {};
    const rawBalances = {};
    for (let i = 0; i < results.length; i++) {
      const meta = idToSym[i + 1];
      if (!meta) continue;
      const r = results[i];
      const raw = r && r.result && r.result !== '0x' ? BigInt(r.result).toString() : '0';
      balances[meta.sym] = Number(raw) / Math.pow(10, meta.decimals);
      rawBalances[meta.sym] = raw;
    }
    if (balances.WETH !== undefined) {
      balances.ETH = balances.WETH;
      rawBalances.ETH = rawBalances.WETH;
    }
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ address, balances, rawBalances, ts: Date.now() });
  } catch (e) {
    return res.status(502).json({ error: 'Error consultando el RPC', detail: String(e) });
  }
};
