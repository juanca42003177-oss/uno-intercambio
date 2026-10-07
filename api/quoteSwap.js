// quoteSwap — cotización contra pools reales de World Chain (Vercel, gratis).
// Port del backend Base44 sin secrets: direcciones públicas hardcodeadas.
const { rpcBatch, hexToBigInt, padAddr, padNum } = require('./_rpc');

const WETH = '0x4200000000000000000000000000000000000006';
const QUOTER = '0x10158D43e6cc414deE1Bd1eB0EfC6a5cBCfF244c';
const V3_FACTORY = '0x7a5028BDa40e7B173C278C5342087826455ea25a';
const V2_FACTORY = '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f';
const USDC = '0x79a02482a880bce3f13e09da970dc34db4cd24d1';
const DNA = '0xed49fe44fd4249a09843c2ba4bba7e50beca7113';
const AXO = '0x249820c0479d0a7fee6a2a3a14583267550f3caf';
const WLD = '0x2cfc85d8e48f8eab294be644d9e25c3030863003';
const CHAD = '0x50723a159ba02a1ada4d7e1a32835f7ff1f1be89';
const TIERS = [500, 3000, 10000];
const DNA_TAX_BPS = 1500n;

const v3PoolCache = new Map(); // pkey -> tiers
const v2PairCache = new Map(); // pkey -> addr | null

function pkey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
function v2Pairs() { return [[DNA, WETH], [AXO, WLD], [CHAD, WETH]]; }

async function discoverPools(pairs) {
  const v2set = new Set(v2Pairs().map((p) => pkey(p[0], p[1])));
  const calls = [];
  const meta = [];
  const pending = [];
  for (const [a, b] of pairs) {
    const key = pkey(a, b);
    if (v2set.has(key)) {
      if (!v2PairCache.has(key)) {
        calls.push({ to: V2_FACTORY, data: '0xe6a43905' + padAddr(a) + padAddr(b) });
        meta.push({ kind: 'v2pair', key, tier: 0 });
      }
    } else if (!v3PoolCache.has(key)) {
      pending.push(key);
      for (const tier of TIERS) {
        calls.push({ to: V3_FACTORY, data: '0x1698ee82' + padAddr(a) + padAddr(b) + padNum(tier) });
        meta.push({ kind: 'v3pool', key, tier });
      }
    }
  }
  if (calls.length === 0) return;
  const results = await rpcBatch(calls);
  const tiersByKey = new Map();
  for (let i = 0; i < meta.length; i++) {
    const m = meta[i];
    const r = results[i];
    const val = r && r.result ? hexToBigInt(r.result) : 0n;
    if (m.kind === 'v3pool') {
      if (val !== 0n) {
        const cur = tiersByKey.get(m.key) || [];
        cur.push(m.tier);
        tiersByKey.set(m.key, cur);
      }
    } else {
      const hex = r && r.result;
      v2PairCache.set(m.key, hex && hex.length >= 42 ? '0x' + hex.slice(-40) : null);
    }
  }
  for (const [key, tiers] of tiersByKey) v3PoolCache.set(key, tiers);
  for (const key of pending) if (!v3PoolCache.has(key)) v3PoolCache.set(key, []);
}

function quoteV2Formula(a, b, inRes, outRes, amountIn) {
  let realAmountIn = amountIn;
  if (a === DNA) realAmountIn = (amountIn * (10000n - DNA_TAX_BPS)) / 10000n;
  const withFee = realAmountIn * 997n;
  const num = withFee * outRes;
  const den = inRes * 1000n + withFee;
  if (den <= 0n || num <= 0n) return null;
  let out = num / den;
  if (b === DNA) out = (out * (10000n - DNA_TAX_BPS)) / 10000n;
  return out;
}

async function quoteLegs(reqs) {
  const calls = [];
  const meta = [];
  for (let i = 0; i < reqs.length; i++) {
    const req = reqs[i];
    if (req.amountIn <= 0n) continue;
    const key = pkey(req.a, req.b);
    const v2Addr = v2PairCache.get(key);
    if (v2Addr) {
      calls.push({ to: v2Addr, data: '0x0902f1ac' });
      meta.push({ kind: 'v2res', idx: i, tier: 0 });
    } else {
      for (const tier of v3PoolCache.get(key) || []) {
        calls.push({ to: QUOTER, data: '0xc6a5026a' + padAddr(req.a) + padAddr(req.b) + padNum(req.amountIn) + padNum(tier) + padNum(0) });
        meta.push({ kind: 'v3quote', idx: i, tier });
      }
    }
  }
  const best = reqs.map(() => null);
  if (calls.length === 0) return best;
  const results = await rpcBatch(calls);
  for (let j = 0; j < meta.length; j++) {
    const m = meta[j];
    const req = reqs[m.idx];
    const r = results[j];
    if (m.kind === 'v3quote') {
      const hex = r && r.result && r.result.length >= 66 ? r.result : null;
      const out = hex ? hexToBigInt('0x' + hex.slice(2, 66)) : 0n;
      if (out > 0n && (!best[m.idx] || out > best[m.idx].expectedOut)) {
        best[m.idx] = { kind: 'v3', fee: m.tier, tokenIn: req.a, tokenOut: req.b, amountIn: req.amountIn, expectedOut: out, path: null };
      }
    } else {
      const hex = r && r.result && r.result.length >= 194 ? r.result.slice(2) : null;
      if (!hex) continue;
      const rr0 = hexToBigInt('0x' + hex.slice(0, 64));
      const rr1 = hexToBigInt('0x' + hex.slice(64, 128));
      if (rr0 <= 0n || rr1 <= 0n) continue;
      const aIsToken0 = req.a < req.b;
      const inRes = aIsToken0 ? rr0 : rr1;
      const outRes = aIsToken0 ? rr1 : rr0;
      const out = quoteV2Formula(req.a, req.b, inRes, outRes, req.amountIn);
      if (out && out > 0n) {
        best[m.idx] = { kind: 'v2', fee: 0, tokenIn: req.a, tokenOut: req.b, amountIn: req.amountIn, expectedOut: out, path: [req.a, req.b] };
      }
    }
  }
  return best;
}

function applySlip(amount, slipBps) { return (amount * BigInt(10000 - slipBps)) / 10000n; }

const quoteCache = new Map();
const QUOTE_TTL = 3000;

module.exports = async (req, res) => {
  const body = req.body || {};
  const tokenIn = String(body.tokenIn || '').toLowerCase();
  const tokenOut = String(body.tokenOut || '').toLowerCase();
  let amountIn = 0n;
  try { amountIn = BigInt(body.amountIn || '0'); } catch (e) {}

  if (tokenIn === tokenOut) return res.status(200).json({ ok: false, note: 'Elige tokens diferentes' });
  if (amountIn <= 0n) return res.status(200).json({ ok: false, note: 'Monto inválido' });

  const ck = tokenIn + '|' + tokenOut + '|' + amountIn.toString();
  const hit = quoteCache.get(ck);
  if (hit && Date.now() - hit.ts < QUOTE_TTL) return res.status(200).json(hit.body);
  if (quoteCache.size > 500) quoteCache.clear();

  const exotic = new Set();
  ['0xed49fe44fd4249a09843c2ba4bba7e50beca7113', '0x249820c0479d0a7fee6a2a3a14583267550f3caf',
   '0x2ba918fec90ca7aac5753a2551593470815866e6', '0xbc69990a060cc5af40942f579bdf82a69a9cff93',
   '0xd469fda5d9522a093760902e9be51e0c5d822d26', '0xab09a728e53d3d6bc438be95eed46da0bbe7fb38',
   '0xcd1e32b86953d79a6ac58e813d2ea7a1790cab63', '0x834a73c0a83f3bce349a116ffb2a4c2d1c651e45',
   '0xede54d9c024ee80c85ec0a75ed2d8774c7fbac9b', '0xf3f92a60e6004f3982f0fde0d43602fc0a30a0db',
   CHAD, '0x12e96c2bfea6e835cf8dd38a5834fa61cf723736', '0x2615a94df961278dcbc41fb0a54fec5f10a693ae'].forEach((a) => exotic.add(a));
  const isExotic = exotic.has(tokenIn) || exotic.has(tokenOut);
  const slipBps = isExotic ? 300 : 100;
  const multiSlipBps = Math.max(slipBps, 500);

  try {
    const mids = [WETH, WLD, USDC].filter((m) => m !== tokenIn && m !== tokenOut);
    const pairs = [[tokenIn, tokenOut]];
    for (const mid of mids) pairs.push([tokenIn, mid], [mid, tokenOut]);
    await discoverPools(pairs);

    const round2 = [{ a: tokenIn, b: tokenOut, amountIn }];
    const leg1Idx = new Map();
    for (const mid of mids) {
      leg1Idx.set(mid, round2.length);
      round2.push({ a: tokenIn, b: mid, amountIn });
    }
    const round2Res = await quoteLegs(round2);
    const direct = round2Res[0];

    const round3 = [];
    const leg1ByMid = new Map();
    for (const mid of mids) {
      const leg1 = round2Res[leg1Idx.get(mid)];
      if (!leg1) continue;
      const leg1Min = applySlip(leg1.expectedOut, multiSlipBps);
      if (leg1Min <= 0n) continue;
      leg1ByMid.set(mid, { leg: leg1, min: leg1Min });
      round3.push({ a: mid, b: tokenOut, amountIn: leg1Min });
    }
    const round3Res = round3.length > 0 ? await quoteLegs(round3) : [];

    let bestType = direct ? direct.kind : 'multi';
    let bestOut = direct ? direct.expectedOut : 0n;
    let bestFee = direct ? direct.fee : 0;
    let bestPath = direct ? direct.path : null;
    let bestLegs = null;
    let mi = 0;
    for (const mid of mids) {
      const info = leg1ByMid.get(mid);
      if (!info) continue;
      const leg2 = round3Res[mi];
      mi++;
      if (!leg2 || leg2.expectedOut <= bestOut) continue;
      bestOut = leg2.expectedOut;
      bestType = 'multi';
      bestLegs = [
        { type: info.leg.kind, fee: info.leg.fee, tokenIn: info.leg.tokenIn, tokenOut: info.leg.tokenOut, amountIn: info.leg.amountIn.toString(), minOut: info.min.toString(), path: info.leg.path },
        { type: leg2.kind, fee: leg2.fee, tokenIn: leg2.tokenIn, tokenOut: leg2.tokenOut, amountIn: info.min.toString(), minOut: applySlip(leg2.expectedOut, multiSlipBps).toString(), path: leg2.path },
      ];
    }

    if (bestOut <= 0n) {
      return res.status(200).json({ ok: false, note: 'No hay ruta entre estos tokens ahora mismo. Prueba con ETH o WLD de puente.' });
    }
    const finalSlipBps = bestType === 'multi' ? multiSlipBps : slipBps;
    const minOut = applySlip(bestOut, finalSlipBps);
    const resp = bestType === 'multi'
      ? { ok: true, type: 'multi', expectedOut: bestOut.toString(), minOut: minOut.toString(), slipBps: finalSlipBps, legs: bestLegs, ts: Date.now() }
      : { ok: true, type: bestType, fee: bestFee, path: bestPath, expectedOut: bestOut.toString(), minOut: minOut.toString(), slipBps: finalSlipBps, ts: Date.now() };
    quoteCache.set(ck, { ts: Date.now(), body: resp });
    return res.status(200).json(resp);
  } catch (e) {
    return res.status(200).json({ ok: false, note: 'Error consultando el pool: ' + String(e).slice(0, 120) });
  }
};
