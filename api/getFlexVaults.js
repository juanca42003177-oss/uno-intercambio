// getFlexVaults — bóvedas flexibles (1% flat) para Intercambio X SwapX en Vercel
const { rpcBatch, hexToBigInt, padAddr, padNum } = require('./_rpc');

const VAULTS = [
  { id: 'wld',  name: 'WLD / ETH',  symA: 'WLD',  symB: 'ETH', addr: '0xef4D662397a88c6ba59485aEC013540944b788E3', tokenA: '0x2cFc85d8E48F8EAB294be644d9E25C3030863003', tokenADecimals: 18, minUsd: 1, feeNote: '1% flat al retirar' },
  { id: 'wdd',  name: 'WDD / ETH',  symA: 'WDD',  symB: 'ETH', addr: '0x9Ecc9d734673583c044EbD58d5D5b4e801E7d5Cb', tokenA: '0xEdE54d9c024ee80C85ec0a75eD2d8774c7Fbac9B', tokenADecimals: 18, minUsd: 1, feeNote: '1% flat al retirar' },
  { id: 'chad', name: 'CHAD / ETH', symA: 'CHAD', symB: 'ETH', addr: '0x09f18e9392bB6793B5E47c60b5398328e5e28aC5', tokenA: '0x50723A159ba02A1ADA4d7E1A32835f7ff1F1bE89', tokenADecimals: 18, minUsd: 1, feeNote: '1% flat al retirar' },
];
const SEL = {
  minDeposit: '0x41b3d185',
  depositsPaused: '0x60da3e83',
  depositsLength: '0xcb85b972',
  depositInfo: '0xb9d774df',
};
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

let staticCache = null; // { ts, data } — 30 s, datos no dependen del usuario

module.exports = async (req, res) => {
  try {
    let wallet = ZERO_ADDR;
    try {
      const q = (req.query && req.query.wallet) || (req.url && new URL(req.url, 'http://x').searchParams.get('wallet'));
      if (q && /^0x[0-9a-fA-F]{40}$/.test(q)) wallet = q;
    } catch (e) { /* sin wallet */ }

    // configuración estática (con caché)
    let stat;
    if (staticCache && Date.now() - staticCache.ts < 30000) {
      stat = staticCache.data;
    } else {
      const calls = [];
      VAULTS.forEach((v) => {
        calls.push({ to: v.addr, data: SEL.minDeposit });
        calls.push({ to: v.addr, data: SEL.depositsPaused });
      });
      const r = await rpcBatch(calls);
      stat = VAULTS.map((v, i) => ({
        minDeposit: String(hexToBigInt(r[i * 2] && r[i * 2].result)),
        depositsPaused: hexToBigInt(r[i * 2 + 1] && r[i * 2 + 1].result) === 1n,
      }));
      staticCache = { ts: Date.now(), data: stat };
    }

    // depósitos del usuario
    const deps = {};
    VAULTS.forEach((v) => { deps[v.id] = []; });
    if (wallet !== ZERO_ADDR) {
      const lens = await rpcBatch(VAULTS.map((v) => ({ to: v.addr, data: SEL.depositsLength + padAddr(wallet) })));
      const info = [];
      const calls = [];
      VAULTS.forEach((v, vi) => {
        const n = Math.min(Number(hexToBigInt(lens[vi] && lens[vi].result)), 10);
        for (let i = 0; i < n; i++) {
          calls.push({ to: v.addr, data: SEL.depositInfo + padAddr(wallet) + padNum(i) });
          info.push({ vi, index: i });
        }
      });
      if (calls.length > 0) {
        const rows = await rpcBatch(calls);
        rows.forEach((r, k) => {
          const t = String((r && r.result) || '0x').slice(2);
          const chunk = (from) => { try { return BigInt('0x' + (t.slice(from * 64, from * 64 + 64) || '0')).toString(); } catch (e) { return '0'; } };
          const liquidity = chunk(1);
          if (liquidity !== '0') {
            deps[VAULTS[info[k].vi].id].push({
              index: info[k].index,
              principalA: chunk(0),
              liquidity: liquidity,
              active: Number(chunk(2)) === 1,
            });
          }
        });
      }
    }

    const vaults = VAULTS.map((v, i) => ({
      id: v.id, name: v.name, symA: v.symA, symB: v.symB, addr: v.addr,
      tokenA: v.tokenA, tokenADecimals: v.tokenADecimals,
      minDeposit: stat[i].minDeposit, minUsd: v.minUsd,
      depositsPaused: stat[i].depositsPaused, feeNote: v.feeNote, noLock: true,
      deposits: deps[v.id] || [],
    }));
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, vaults });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
