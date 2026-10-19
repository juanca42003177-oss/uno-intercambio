// Historial de precios por moneda (para graficos de tokens exoticos sin CoinGecko).
// Datos grabados por priceAlerts cada 5 min en dragon-labs-data: history/prices.json
const wrap = require('./_cors');
let cache = null;
module.exports = wrap(async (req, res) => {
  try {
    const sym = (req.query && req.query.sym) || null;
    if (cache && Date.now() - cache.ts < 240000) {
      return res.status(200).json({ ok: true, hist: sym ? (cache.data[sym] || []) : cache.data });
    }
    const r = await fetch('https://api.github.com/repos/' + (process.env.GITHUB_DATA_REPO || 'juanca42003177-oss/dragon-labs-data') + '/contents/history/prices.json?ref=alerts-data', {
      headers: { Authorization: 'Bearer ' + (process.env.GITHUB_TOKEN || ''), Accept: 'application/vnd.github+json' },
    });
    let data = {};
    if (r.ok) {
      const j = await r.json();
      try { data = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8') || '{}'); } catch (e) { data = {}; }
      cache = { data, ts: Date.now() };
    }
    return res.status(200).json({ ok: true, hist: sym ? (data[sym] || []) : data });
  } catch (e) {
    return res.status(200).json({ ok: true, hist: [] });
  }
});
