// getMarketPrices — port fiel del backend Base44 (CoinGecko + Kraken + Dexscreener).
// Sin snapshot a PriceSnap (eso vive en Base44): solo precios frescos, gratis en Vercel.
const KRAKEN_TICKER_PAIRS = {
  WLD: 'WLDUSD', WETH: 'ETHUSD', ETH: 'ETHUSD', WBTC: 'XBTUSD',
  uSOL: 'SOLUSD', uXRP: 'XRPUSD', uDOGE: 'XDGUSD', SUSHI: 'SUSHIUSD',
};
const WETH_ADDR = '0x4200000000000000000000000000000000000006';

const DEX_TOKENS = {
  WLD:      { addr: '0x2cFc85d8E48F8EAB294be644d9E25C3030863003' },
  USDC:     { addr: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1' },
  DNA:      { addr: '0xed49fe44fd4249a09843c2ba4bba7e50beca7113' },
  HUB:      { addr: '0xd469fda5d9522a093760902e9be51e0c5d822d26' },
  ORO:      { addr: '0xcd1e32b86953d79a6ac58e813d2ea7a1790cab63' },
  SUSHI:    { addr: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38' },
  DIAMANTE: { addr: '0x2ba918fec90Ca7AaC5753a2551593470815866e6' },
  PVPB:     { addr: '0xBC69990A060cC5AF40942f579BdF82A69A9CFf93' },
  TPF:      { addr: '0x834a73c0a83F3BCe349A116FFB2A4c2d1C651E45' },
  AXO:      { addr: '0x249820C0479D0A7feE6A2A3a14583267550F3caF' },
  WDD:      { addr: '0xEdE54d9c024ee80C85ec0a75eD2d8774c7Fbac9B' },
  ORB:      { addr: '0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB' },
  CHAD:     { addr: '0x50723A159ba02A1ADA4d7E1A32835f7ff1F1bE89' },
};
const DEFAULT_PRICES = {
  WLD: 0.38, DNA: 0.00000045, HUB: 0.0000008, ORO: 0.002, USDC: 1,
  ETH: 3400, WETH: 3400, SUSHI: 0.5, DIAMANTE: 0.0001, PVPB: 0.0001,
  TPF: 0.0001, AXO: 0.0001, WDD: 0.002, ORB: 0.001, uSOL: 103.70, WBTC: 77412.12, CHAD: 0.72, uDOGE: 0.087, uXRP: 1.40,
};

let cache = null; // { data, ts } — 5.5 min
let lastGoodPrices = { ...DEFAULT_PRICES };

async function fetchJsonOnce(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}
async function fetchJson(url, timeoutMs) {
  const r1 = await fetchJsonOnce(url, timeoutMs);
  if (r1 !== null) return r1;
  await new Promise((ok) => setTimeout(ok, 1500 + Math.floor(Math.random() * 1000)));
  return fetchJsonOnce(url, timeoutMs);
}

function krakenNormalize(pair) {
  return pair.replace(/^X(?=[A-Z0-9]{3,5}Z[A-Z]{3,4}$)/, '').replace(/Z(?=[A-Z]{3,4}$)/, '');
}

const wrap = require('./_cors');
const CG_SPARK_IDS = ['worldcoin-wld','usd-coin','weth','wrapped-bitcoin'];
const SPARK_SYM_BY_ID = { 'worldcoin-wld':['WLD'], 'usd-coin':['USDC'], 'weth':['ETH','WETH'], 'wrapped-bitcoin':['WBTC'] };
let lastGoodSpark = {};

module.exports = wrap(async (req, res) => {
  try {
    if (cache && Date.now() - cache.ts < 330000) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.status(200).json(cache.data);
    }
    const prices = { ...lastGoodPrices };
    const changes = {};

    const exotics = Object.keys(DEX_TOKENS);
    const uniqueAddresses = [...new Set(exotics.map((s) => DEX_TOKENS[s].addr.toLowerCase()))];
    const chunks = [];
    for (let i = 0; i < uniqueAddresses.length; i += 5) chunks.push(uniqueAddresses.slice(i, i + 5));

    const krakenPairs = [...new Set(Object.values(KRAKEN_TICKER_PAIRS))];
    const [cg, kraken, ...dsChunks] = await Promise.all([
    // el ultimo elemento es la respuesta de sparkline de CoinGecko
      fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=worldcoin-wld,usd-coin,weth&vs_currencies=usd&include_24hr_change=true'),
      fetchJson('https://api.kraken.com/0/public/Ticker?pair=' + krakenPairs.join(',')),
      ...chunks.map((c) => fetchJson('https://api.dexscreener.com/latest/dex/tokens/' + c.join(','), 6000)),
      fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + CG_SPARK_IDS.join(',') + '&sparkline=true', 9000),
    ]);
    const allPairs = [];
    for (const ds of dsChunks) {
      if (ds && Array.isArray(ds.pairs)) allPairs.push(...ds.pairs);
    }

    // 1) CoinGecko: WLD, USDC, WETH
    if (cg) {
      if (cg['worldcoin-wld']) {
        prices.WLD = cg['worldcoin-wld'].usd ?? prices.WLD;
        changes.WLD = cg['worldcoin-wld'].usd_24h_change ?? 0;
      }
      if (cg['usd-coin']) {
        prices.USDC = cg['usd-coin'].usd ?? 1;
        changes.USDC = cg['usd-coin'].usd_24h_change ?? 0;
      }
      if (cg['weth']) {
        prices.ETH = cg['weth'].usd ?? prices.ETH;
        prices.WETH = cg['weth'].usd ?? prices.WETH;
        changes.ETH = cg['weth'].usd_24h_change ?? 0;
        changes.WETH = cg['weth'].usd_24h_change ?? 0;
      }
    }

    // 1b) Kraken: respaldo de tokens grandes cuando CoinGecko falla
    if (kraken && kraken.result) {
      const symByPair = {};
      for (const [sym, pair] of Object.entries(KRAKEN_TICKER_PAIRS)) {
        const norm = krakenNormalize(pair);
        if (!symByPair[norm]) symByPair[norm] = [];
        symByPair[norm].push(sym);
      }
      for (const [rawPair, t] of Object.entries(kraken.result)) {
        const pair = krakenNormalize(rawPair);
        const syms = symByPair[pair];
        if (!syms || !t.c) continue;
        const last = parseFloat(t.c[0]);
        const open = parseFloat(t.o);
        if (!(last > 0)) continue;
        const chg = open > 0 ? ((last - open) / open) * 100 : 0;
        for (const sym of syms) {
          if (changes[sym] === undefined) {
            prices[sym] = last;
            changes[sym] = chg;
          }
        }
      }
    }

    // 2) Dexscreener: exóticos de World Chain con el par más líquido por token
    if (allPairs.length > 0) {
      const addrToSyms = {};
      for (const sym of exotics) {
        const a = DEX_TOKENS[sym].addr.toLowerCase();
        if (!addrToSyms[a]) addrToSyms[a] = [];
        addrToSyms[a].push(sym);
      }
      const bestByToken = {};
      for (const p of allPairs) {
        if (p.chainId !== 'worldchain') continue;
        const base = String((p.baseToken && p.baseToken.address) || '').toLowerCase();
        const syms = addrToSyms[base];
        if (!syms) continue;
        const liq = (p.liquidity && p.liquidity.usd) || 0;
        for (const sym of syms) {
          if (!bestByToken[sym] || liq > ((bestByToken[sym].liquidity && bestByToken[sym].liquidity.usd) || 0)) {
            bestByToken[sym] = p;
          }
        }
      }
      for (const [sym, p] of Object.entries(bestByToken)) {
        if (p.priceUsd) {
          const px = parseFloat(p.priceUsd);
          if (px > 0) prices[sym] = px;
          const ch = parseFloat((p.priceChange && p.priceChange.h24) || '0');
          if (!isNaN(ch)) changes[sym] = ch;
        }
      }
    }

    if (prices.WETH !== undefined) prices.ETH = prices.WETH;

    const cgm = dsChunks.pop();
    const spark = {};
    if (Array.isArray(cgm)) {
      for (const m of cgm) {
        const syms = SPARK_SYM_BY_ID[m.id] || [];
        const arr = m.sparkline_in_7d && m.sparkline_in_7d.price;
        if (Array.isArray(arr) && arr.length > 2) for (const s of syms) spark[s] = arr;
      }
    }
    if (Object.keys(spark).length) lastGoodSpark = spark;

    for (const [sym, v] of Object.entries(prices)) {
      if (v !== DEFAULT_PRICES[sym]) lastGoodPrices[sym] = v;
    }

    const live = (cg !== null) || allPairs.length > 0 || (kraken !== null && !!kraken.result);
    const data = { prices, changes, spark: lastGoodSpark, ts: Date.now(), live, source: 'vercel-swapx-market' };
    cache = { data, ts: Date.now() };
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(200).json({ prices: lastGoodPrices, changes: {}, spark: lastGoodSpark, ts: Date.now() });
  }
});
