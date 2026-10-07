// _rpc.js — RPC de World Chain para las funciones Vercel de SwapX (sin secrets).
// Primario: endpoint público de Alchemy (acepta batches grandes, sin API key).
// Respaldo: drpc gratis (batches de máx 3, se trocea en paralelo).

const RPCS = [
  { url: 'https://worldchain-mainnet.g.alchemy.com/public', batch: 100 },
  { url: 'https://worldchain.drpc.org', batch: 3 },
];

async function fetchBatch(endpoint, payload) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const arr = Array.isArray(json) ? json : [json];
    const byId = new Map();
    for (const r of arr) byId.set(r.id, r);
    return payload.map((b) => byId.get(b.id) || null);
  } catch (e) {
    return null;
  }
}

// calls: [{to, data}] -> array de results (objeto RPC o null)
async function rpcBatch(calls) {
  if (!calls || calls.length === 0) return [];
  for (const ep of RPCS) {
    const chunks = [];
    for (let i = 0; i < calls.length; i += ep.batch) chunks.push(calls.slice(i, i + ep.batch));
    const payloads = chunks.map((ch, ci) =>
      ch.map((c, j) => ({ jsonrpc: '2.0', id: ci * ep.batch + j + 1, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }))
    );
    const results = await Promise.all(payloads.map((p) => fetchBatch(ep.url, p)));
    const out = new Array(calls.length).fill(null);
    let any = false;
    let bad = false;
    for (let k = 0; k < results.length; k++) {
      const r = results[k];
      if (!r) { bad = true; continue; }
      for (let j = 0; j < r.length; j++) {
        const item = r[j];
        // respuestas con error (sin .result) marcan revertidas
        out[k * ep.batch + j] = item ? (item.result === undefined ? { result: '0x' } : item) : null;
        if (item && item.result !== undefined) any = true;
        else bad = true;
      }
    }
    if (any && !bad) return out; // endpoint completo
    if (any) return out; // endpoint respondió al menos algo útil
  }
  return new Array(calls.length).fill(null);
}

function hexToBigInt(hex) {
  if (!hex || typeof hex !== 'string' || hex === '0x' || hex.length <= 2) return 0n;
  try { return BigInt(hex); } catch (e) { return 0n; }
}

function padAddr(a) { return a.toLowerCase().replace(/^0x/, '').padStart(64, '0'); }
function padNum(n) { return BigInt(n).toString(16).padStart(64, '0'); }

module.exports = { rpcBatch, hexToBigInt, padAddr, padNum };
