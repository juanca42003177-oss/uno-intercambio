// NO44 — capa de respaldo directo (sin Base44) para Intercambio X SwapX.
// Si los backends de Base44 no responden (créditos agotados, caída, etc.),
// la app consulta directo a las APIs públicas (RPC de World Chain, CoinGecko,
// Dexscreener) desde el navegador, igual que cualquier mini app normal.
// Las funciones devuelven EXACTAMENTE el mismo formato que los backends.

// ---------------- RPC público de World Chain (CORS abierto) ----------------
var NO44_RPC = [
  'https://worldchain.drpc.org',
  'https://rpc.worldchain.llamarpc.com'
];

var NO44_BATCH = 3; // el RPC público gratuito solo acepta batches de hasta 3

async function no44RpcOne(endpoint, chunk) {
  try {
    var res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk)
    });
    if (!res.ok) return null;
    var json = await res.json();
    var arr = Array.isArray(json) ? json : [json];
    var byId = {};
    arr.forEach(function (r) {
      // respuestas con error (sin .result) se marcan como revertidas ('0x')
      byId[r.id] = (r.result === undefined) ? { id: r.id, result: '0x' } : r;
    });
    return chunk.map(function (b) { return byId[b.id] || null; });
  } catch (err) {
    return null;
  }
}

async function no44RpcBatch(calls) {
  if (!calls || calls.length === 0) return [];
  var body = calls.map(function (c, i) {
    return { jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params };
  });
  var chunks = [];
  for (var i = 0; i < body.length; i += NO44_BATCH) chunks.push(body.slice(i, i + NO44_BATCH));
  var out = new Array(body.length).fill(null);
  for (var e = 0; e < NO44_RPC.length; e++) {
    var results = await Promise.all(chunks.map(function (ch) { return no44RpcOne(NO44_RPC[e], ch); }));
    var any = false;
    for (var k = 0; k < chunks.length; k++) {
      var r = results[k];
      if (!r) continue;
      for (var j = 0; j < r.length; j++) {
        out[chunks[k][j].id - 1] = r[j];
        any = true;
      }
    }
    if (any) break; // este endpoint respondió; no probar el siguiente
  }
  return out;
}

function no44PadAddr(a) { return a.replace(/^0x/, '').toLowerCase().padStart(64, '0'); }
function no44PadNum(n) { return n.toString(16).padStart(64, '0'); }
function no44HexToBigInt(hex) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('0x') || hex.length <= 2) return null;
  try { return BigInt(hex); } catch (e) { return null; }
}

// ---------------- utilidades de tokens (leen la lista de la app) ----------------
function no44AddrOf(sym) {
  if (sym === 'ETH' || sym === 'WETH') return '0x4200000000000000000000000000000000000006';
  var c = window.CONTRACTS && window.CONTRACTS[sym];
  return c ? c.address.toLowerCase() : null;
}
function no44DecimalsOf(sym) {
  if (sym === 'ETH' || sym === 'WETH') return 18;
  var c = window.CONTRACTS && window.CONTRACTS[sym];
  return c ? c.decimals : 18;
}

// ---------------- SALDOS: batch JSON-RPC directo ----------------
async function no44Balances(address) {
  var addr = String(address || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return { address: addr, balances: {}, rawBalances: {}, ts: Date.now() };
  var batch = [];
  var idToSym = {};
  var id = 1;
  var syms = Object.keys(window.CONTRACTS || {});
  for (var i = 0; i < syms.length; i++) {
    var sym = syms[i];
    if (sym === 'ETH') continue; // ETH = WETH en World App
    var a = no44AddrOf(sym);
    if (!a) continue;
    batch.push({ method: 'eth_call', params: [{ to: a, data: '0x70a08231' + addr.slice(2).padStart(64, '0') }, 'latest'] });
    idToSym[id] = sym;
    id++;
  }
  var balances = {};
  var rawBalances = {};
  var results = await no44RpcBatch(batch);
  for (var k = 0; k < results.length; k++) {
    var sym2 = idToSym[k + 1];
    if (!sym2) continue;
    var raw = '0';
    var val = 0;
    var r = results[k];
    if (r && r.result && r.result !== '0x') {
      try {
        raw = BigInt(r.result).toString();
        val = Number(raw) / Math.pow(10, no44DecimalsOf(sym2));
      } catch (err) { raw = '0'; val = 0; }
    }
    balances[sym2] = val;
    rawBalances[sym2] = raw;
  }
  if (balances.WETH !== undefined) {
    balances.ETH = balances.WETH;
    rawBalances.ETH = rawBalances.WETH;
  }
  return { address: addr, balances: balances, rawBalances: rawBalances, ts: Date.now() };
}

// ---------------- PRECIOS: CoinGecko (grandes) + Dexscreener (exóticos) ----------------
var NO44_CG_IDS = {
  WLD: 'worldcoin-wld', ETH: 'weth', WETH: 'weth', WBTC: 'wrapped-bitcoin',
  uSOL: 'solana', uXRP: 'ripple', uDOGE: 'dogecoin', USDC: 'usd-coin'
};

async function no44FetchJson(url, timeoutMs) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 6000);
  try {
    var res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function no44Prices() {
  var prices = {};
  var changes = {};
  // CoinGecko para los tokens grandes (mismos ids que el backend original)
  var cgSyms = Object.keys(NO44_CG_IDS);
  var idsParam = cgSyms.map(function (s) { return NO44_CG_IDS[s]; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(',');
  var cg = await no44FetchJson('https://api.coingecko.com/api/v3/simple/price?ids=' + idsParam + '&vs_currencies=usd&include_24hr_change=true', 6000);
  if (cg) {
    cgSyms.forEach(function (sym) {
      var id = NO44_CG_IDS[sym];
      if (cg[id] && typeof cg[id].usd === 'number') {
        prices[sym] = cg[id].usd;
        if (cg[id].usd_24h_change !== undefined) changes[sym] = cg[id].usd_24h_change;
      }
    });
  }
  // Dexscreener para los exóticos de World Chain (endpoint tokens/, mismo criterio
  // del backend: el par más líquido por token, solo cadena worldchain)
  var NO44_DEX_ONLY = ['WLD', 'USDC', 'DNA', 'HUB', 'ORO', 'SUSHI', 'DIAMANTE', 'PVPB', 'TPF', 'AXO', 'WDD', 'ORB', 'CHAD'];
  var addrs = NO44_DEX_ONLY.map(function (s) { return no44AddrOf(s); }).filter(Boolean);
  try {
    var blocks = [];
    for (var i = 0; i < addrs.length; i += 5) blocks.push(addrs.slice(i, i + 5));
    var results = await Promise.all(blocks.map(function (blk) {
      return no44FetchJson('https://api.dexscreener.com/latest/dex/tokens/' + blk.join(','), 7000);
    }));
    var bestByToken = {};
    var addrToSyms = {};
    NO44_DEX_ONLY.forEach(function (sym) {
      var a = no44AddrOf(sym);
      if (a) { (addrToSyms[a] = addrToSyms[a] || []).push(sym); }
    });
    results.forEach(function (data) {
      if (!data || !Array.isArray(data.pairs)) return;
      data.pairs.forEach(function (p) {
        if (p.chainId !== 'worldchain') return;
        var base = String((p.baseToken && p.baseToken.address) || '').toLowerCase();
        var syms = addrToSyms[base];
        if (!syms) return;
        var liq = (p.liquidity && p.liquidity.usd) || 0;
        syms.forEach(function (sym) {
          if (!bestByToken[sym] || liq > ((bestByToken[sym].liquidity && bestByToken[sym].liquidity.usd) || 0)) bestByToken[sym] = p;
        });
      });
    });
    NO44_DEX_ONLY.forEach(function (sym) {
      var p = bestByToken[sym];
      if (p && p.priceUsd) {
        var px = parseFloat(p.priceUsd);
        if (px > 0) prices[sym] = px;
        var ch = parseFloat((p.priceChange && p.priceChange.h24) || '0');
        if (!isNaN(ch)) changes[sym] = ch;
      }
    });
  } catch (e) { /* CoinGecko solo */ }
  if (prices.WETH !== undefined && prices.ETH === undefined) prices.ETH = prices.WETH;
  if (prices.ETH !== undefined) prices.WETH = prices.ETH;
  return { prices: prices, changes: changes, ts: Date.now() };
}

// ---------------- BÓVEDAS FLEXIBLES: lectura directa de los contratos ----------------
var NO44_FLEX_VAULTS = [
  { id: 'wld',  name: 'WLD / ETH',  symA: 'WLD',  symB: 'ETH', addr: '0xef4D662397a88c6ba59485aEC013540944b788E3', tokenA: '0x2cFc85d8E48F8EAB294be644d9E25C3030863003', tokenADecimals: 18, minUsd: 1, feeNote: '1% flat al retirar' },
  { id: 'wdd',  name: 'WDD / ETH',  symA: 'WDD',  symB: 'ETH', addr: '0x9Ecc9d734673583c044EbD58d5D5b4e801E7d5Cb', tokenA: '0xEdE54d9c024ee80C85ec0a75eD2d8774c7Fbac9B', tokenADecimals: 18, minUsd: 1, feeNote: '1% flat al retirar' },
  { id: 'chad', name: 'CHAD / ETH', symA: 'CHAD', symB: 'ETH', addr: '0x09f18e9392bB6793B5E47c60b5398328e5e28aC5', tokenA: '0x50723A159ba02A1ADA4d7E1A32835f7ff1F1bE89', tokenADecimals: 18, minUsd: 1, feeNote: '1% flat al retirar' }
];
var NO44_SEL = { minDeposit: '0x41b3d185', depositsPaused: '0x60da3e83', depositsLength: '0xcb85b972', depositInfo: '0xb9d774df' };

async function no44FlexVaults(wallet) {
  var w = String(wallet || '').toLowerCase();
  var out = [];
  // 1) configuración estática de las 3
  var calls = [];
  NO44_FLEX_VAULTS.forEach(function (v) {
    calls.push({ method: 'eth_call', params: [{ to: v.addr, data: NO44_SEL.minDeposit }, 'latest'] });
    calls.push({ method: 'eth_call', params: [{ to: v.addr, data: NO44_SEL.depositsPaused }, 'latest'] });
  });
  var res = await no44RpcBatch(calls);
  var i;
  for (i = 0; i < NO44_FLEX_VAULTS.length; i++) {
    var md = res[i * 2] && no44HexToBigInt(res[i * 2].result);
    var pn = res[i * 2 + 1] && no44HexToBigInt(res[i * 2 + 1].result);
    out.push(Object.assign({}, NO44_FLEX_VAULTS[i], {
      minDeposit: String(md || 0n),
      depositsPaused: pn === 1n,
      deposits: []
    }));
  }
  // 2) depósitos del usuario (si hay wallet)
  if (/^0x[0-9a-f]{40}$/.test(w)) {
    var lenCalls = NO44_FLEX_VAULTS.map(function (v) {
      return { method: 'eth_call', params: [{ to: v.addr, data: NO44_SEL.depositsLength + no44PadAddr(w) }, 'latest'] };
    });
    var lens = await no44RpcBatch(lenCalls);
    var info = [];
    var infoCalls = [];
    NO44_FLEX_VAULTS.forEach(function (v, vi) {
      var n = lens[vi] && no44HexToBigInt(lens[vi].result) || 0n;
      var cnt = Number(n > 10n ? 10n : n);
      for (var k = 0; k < cnt; k++) {
        infoCalls.push({ method: 'eth_call', params: [{ to: v.addr, data: NO44_SEL.depositInfo + no44PadAddr(w) + no44PadNum(BigInt(k)) }, 'latest'] });
        info.push({ vi: vi, index: k });
      }
    });
    if (infoCalls.length > 0) {
      var rows = await no44RpcBatch(infoCalls);
      rows.forEach(function (r, k2) {
        if (!r || !r.result || r.result.length < 194) return;
        var hex = r.result.slice(2);
        var principalA = BigInt('0x' + hex.slice(0, 64)).toString();
        var liquidity = BigInt('0x' + hex.slice(64, 128)).toString();
        var active = BigInt('0x' + hex.slice(128, 192)) === 1n;
        if (liquidity !== '0') out[info[k2].vi].deposits.push({ index: info[k2].index, principalA: principalA, liquidity: liquidity, active: active });
      });
    }
  }
  return { ok: true, vaults: out };
}

// ---------------- COTIZACIÓN DE SWAP: port directo del backend quoteSwap ----------------
var NO44_Q = {
  WETH: '0x4200000000000000000000000000000000000006',
  QUOTER: '0x10158D43e6cc414deE1Bd1eB0EfC6a5cBCfF244c',
  V3_FACTORY: '0x7a5028BDa40e7B173C278C5342087826455ea25a',
  V2_FACTORY: '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f',
  TIERS: [500, 3000, 10000],
  DNA_TAX_BPS: 1500n
};

var no44V3PoolCache = {};
var no44V2PairCache = {};

function no44Pkey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

function no44V2Pairs() {
  var dna = no44AddrOf('DNA');
  var axo = no44AddrOf('AXO');
  var wld = no44AddrOf('WLD');
  var out = [];
  if (dna) out.push([dna, NO44_Q.WETH]);
  if (axo && wld) out.push([axo, wld]);
  out.push([no44AddrOf('CHAD'), NO44_Q.WETH]);
  return out.filter(Boolean);
}

async function no44DiscoverPools(pairs) {
  var v2set = {};
  no44V2Pairs().forEach(function (p) { v2set[no44Pkey(p[0], p[1])] = true; });
  var calls = [];
  var meta = [];
  var pending = [];
  pairs.forEach(function (p) {
    var key = no44Pkey(p[0], p[1]);
    if (v2set[key]) {
      if (no44V2PairCache[key] === undefined) {
        calls.push({ method: 'eth_call', params: [{ to: NO44_Q.V2_FACTORY, data: '0xe6a43905' + no44PadAddr(p[0]) + no44PadAddr(p[1]) }, 'latest'] });
        meta.push({ kind: 'v2pair', key: key, tier: 0 });
      }
    } else if (no44V3PoolCache[key] === undefined) {
      pending.push(key);
      NO44_Q.TIERS.forEach(function (tier) {
        calls.push({ method: 'eth_call', params: [{ to: NO44_Q.V3_FACTORY, data: '0x1698ee82' + no44PadAddr(p[0]) + no44PadAddr(p[1]) + no44PadNum(tier) }, 'latest'] });
        meta.push({ kind: 'v3pool', key: key, tier: tier });
      });
    }
  });
  if (calls.length === 0) return;
  var results = await no44RpcBatch(calls);
  var tiersByKey = {};
  for (var i = 0; i < meta.length; i++) {
    var m = meta[i];
    var val = results[i] && no44HexToBigInt(results[i].result);
    if (m.kind === 'v3pool') {
      if (val && val !== 0n) {
        (tiersByKey[m.key] = tiersByKey[m.key] || []).push(m.tier);
      }
    } else {
      var hex = results[i] && results[i].result;
      no44V2PairCache[m.key] = (hex && hex.length >= 42) ? '0x' + hex.slice(-40) : null;
    }
  }
  for (var key2 in tiersByKey) no44V3PoolCache[key2] = tiersByKey[key2];
  pending.forEach(function (k3) { if (no44V3PoolCache[k3] === undefined) no44V3PoolCache[k3] = []; });
}

function no44QuoteV2Formula(a, b, inRes, outRes, amountIn) {
  var dnaAddr = no44AddrOf('DNA');
  var realAmountIn = amountIn;
  if (a === dnaAddr) realAmountIn = (amountIn * (10000n - NO44_Q.DNA_TAX_BPS)) / 10000n;
  var withFee = realAmountIn * 997n;
  var num = withFee * outRes;
  var den = inRes * 1000n + withFee;
  if (den <= 0n || num <= 0n) return null;
  var out = num / den;
  if (b === dnaAddr) out = (out * (10000n - NO44_Q.DNA_TAX_BPS)) / 10000n;
  return out;
}

async function no44QuoteLegs(reqs) {
  var calls = [];
  var meta = [];
  for (var i = 0; i < reqs.length; i++) {
    var req = reqs[i];
    if (req.amountIn <= 0n) continue;
    var key = no44Pkey(req.a, req.b);
    var v2Addr = no44V2PairCache[key];
    if (v2Addr) {
      calls.push({ method: 'eth_call', params: [{ to: v2Addr, data: '0x0902f1ac' }, 'latest'] });
      meta.push({ kind: 'v2res', idx: i, tier: 0 });
    } else {
      (no44V3PoolCache[key] || []).forEach(function (tier) {
        calls.push({ method: 'eth_call', params: [{ to: NO44_Q.QUOTER, data: '0xc6a5026a' + no44PadAddr(req.a) + no44PadAddr(req.b) + no44PadNum(req.amountIn) + no44PadNum(tier) + no44PadNum(0) }, 'latest'] });
        meta.push({ kind: 'v3quote', idx: i, tier: tier });
      });
    }
  }
  var best = reqs.map(function () { return null; });
  if (calls.length === 0) return best;
  var results = await no44RpcBatch(calls);
  for (var j = 0; j < meta.length; j++) {
    var m = meta[j];
    var r = results[j];
    var q = reqs[m.idx];
    if (m.kind === 'v3quote') {
      var hex = (r && r.result && r.result.length >= 66) ? r.result : null;
      var out = hex ? no44HexToBigInt('0x' + hex.slice(2, 66)) : null;
      if (out && out > 0n && (!best[m.idx] || out > best[m.idx].expectedOut)) {
        best[m.idx] = { kind: 'v3', fee: m.tier, tokenIn: q.a, tokenOut: q.b, amountIn: q.amountIn, expectedOut: out, path: null };
      }
    } else {
      var hex2 = (r && r.result && r.result.length >= 194) ? r.result.slice(2) : null;
      if (!hex2) continue;
      var rr0 = no44HexToBigInt('0x' + hex2.slice(0, 64));
      var rr1 = no44HexToBigInt('0x' + hex2.slice(64, 128));
      if (!rr0 || !rr1 || rr0 <= 0n || rr1 <= 0n) continue;
      var aIsToken0 = q.a < q.b;
      var inRes = aIsToken0 ? rr0 : rr1;
      var outRes = aIsToken0 ? rr1 : rr0;
      var out2 = no44QuoteV2Formula(q.a, q.b, inRes, outRes, q.amountIn);
      if (out2 && out2 > 0n) {
        best[m.idx] = { kind: 'v2', fee: 0, tokenIn: q.a, tokenOut: q.b, amountIn: q.amountIn, expectedOut: out2, path: [q.a, q.b] };
      }
    }
  }
  return best;
}

function no44ApplySlip(amount, slipBps) {
  return (amount * BigInt(10000 - slipBps)) / 10000n;
}

var no44QuoteCache = {};
var NO44_QUOTE_TTL = 3000;

async function no44QuoteSwap(tokenIn, tokenOut, amountInStr) {
  var tokenIn = String(tokenIn || '').toLowerCase();
  var tokenOut = String(tokenOut || '').toLowerCase();
  var amountIn;
  try { amountIn = BigInt(amountInStr || '0'); } catch (e) { amountIn = 0n; }
  if (tokenIn === tokenOut) return { ok: false, note: 'Elige tokens diferentes' };
  if (amountIn <= 0n) return { ok: false, note: 'Monto inválido' };

  var ck = tokenIn + '|' + tokenOut + '|' + amountIn.toString();
  var hit = no44QuoteCache[ck];
  if (hit && Date.now() - hit.ts < NO44_QUOTE_TTL) return hit.body;
  var keys = Object.keys(no44QuoteCache);
  if (keys.length > 500) no44QuoteCache = {};

  var exoticSyms = ['DNA', 'AXO', 'DIAMANTE', 'PVPB', 'HUB', 'SUSHI', 'ORO', 'TPF', 'WDD', 'ORB', 'CHAD', 'uDOGE', 'uXRP'];
  var exotic = {};
  exoticSyms.forEach(function (s) { var a = no44AddrOf(s); if (a) exotic[a] = true; });
  var isExotic = exotic[tokenIn] || exotic[tokenOut];
  var slipBps = isExotic ? 300 : 100;
  var multiSlipBps = Math.max(slipBps, 500);

  var usdc = no44AddrOf('USDC');
  var wld = no44AddrOf('WLD');
  var mids = [NO44_Q.WETH, wld, usdc].filter(function (m) { return m && m !== tokenIn && m !== tokenOut; });

  var pairs = [[tokenIn, tokenOut]];
  mids.forEach(function (mid) { pairs.push([tokenIn, mid], [mid, tokenOut]); });
  await no44DiscoverPools(pairs);

  var round2 = [{ a: tokenIn, b: tokenOut, amountIn: amountIn }];
  var leg1Idx = {};
  mids.forEach(function (mid) {
    leg1Idx[mid] = round2.length;
    round2.push({ a: tokenIn, b: mid, amountIn: amountIn });
  });
  var round2Res = await no44QuoteLegs(round2);
  var direct = round2Res[0];

  var round3 = [];
  var leg1ByMid = {};
  mids.forEach(function (mid) {
    var leg1 = round2Res[leg1Idx[mid]];
    if (!leg1) return;
    var leg1Min = no44ApplySlip(leg1.expectedOut, multiSlipBps);
    if (leg1Min <= 0n) return;
    leg1ByMid[mid] = { leg: leg1, min: leg1Min };
    round3.push({ a: mid, b: tokenOut, amountIn: leg1Min });
  });
  var round3Res = round3.length > 0 ? await no44QuoteLegs(round3) : [];

  var bestType = direct ? direct.kind : 'multi';
  var bestOut = direct ? direct.expectedOut : 0n;
  var bestFee = direct ? direct.fee : 0;
  var bestPath = direct ? direct.path : null;
  var bestLegs = null;
  var mi = 0;
  mids.forEach(function (mid) {
    var info = leg1ByMid[mid];
    if (!info) return;
    var leg2 = round3Res[mi];
    mi++;
    if (!leg2 || leg2.expectedOut <= bestOut) return;
    bestOut = leg2.expectedOut;
    bestType = 'multi';
    bestLegs = [
      { type: info.leg.kind, fee: info.leg.fee, tokenIn: info.leg.tokenIn, tokenOut: info.leg.tokenOut, amountIn: info.leg.amountIn.toString(), minOut: info.min.toString(), path: info.leg.path },
      { type: leg2.kind, fee: leg2.fee, tokenIn: leg2.tokenIn, tokenOut: leg2.tokenOut, amountIn: info.min.toString(), minOut: no44ApplySlip(leg2.expectedOut, multiSlipBps).toString(), path: leg2.path }
    ];
  });

  if (bestOut <= 0n) {
    return { ok: false, note: 'No hay ruta entre estos tokens ahora mismo. Prueba con ETH o WLD de puente.' };
  }
  var finalSlipBps = bestType === 'multi' ? multiSlipBps : slipBps;
  var minOut = no44ApplySlip(bestOut, finalSlipBps);
  var resp = bestType === 'multi'
    ? { ok: true, type: 'multi', expectedOut: bestOut.toString(), minOut: minOut.toString(), slipBps: finalSlipBps, legs: bestLegs, ts: Date.now() }
    : { ok: true, type: bestType, fee: bestFee, path: bestPath, expectedOut: bestOut.toString(), minOut: minOut.toString(), slipBps: finalSlipBps, ts: Date.now() };
  no44QuoteCache[ck] = { ts: Date.now(), body: resp };
  return resp;
}
