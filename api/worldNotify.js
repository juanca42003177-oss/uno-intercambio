// worldNotify (Vercel) — notificaciones push de World App (la campanita 🔔).
// Usa la API oficial del Developer Portal:
//   POST https://developer.world.org/api/v2/minikit/send-notification
// Variables de entorno necesarias (en Vercel):
//   WORLD_API_KEY  — API key creada en el Developer Portal (config de la app)
//   WORLD_APP_ID   — app_id de la mini app (app_xxxx)
//   GITHUB_TOKEN   — mismo token que usan priceAlerts/damasMoves
// Suscriptores: notify/subs-swapx.json en la rama 'alerts-data' del repo
// de GitHub (mismo patron que alerts.json). Cero Base44.
//
// Anti-abuso: el servidor SOLO envia mensajes con plantillas fijas (prize / reto);
// nadie desde fuera puede mandar texto arbitrario a los usuarios, y el aviso de
// retos esta limitado a 1 por minuto por instancia.

const BRANCH = 'alerts-data';
const REPO = process.env.GITHUB_ALERTS_REPO || 'juanca42003177-oss/uno-intercambio';
const SUBS_PATH = 'notify/subs-swapx.json';
const APP_LABEL = 'Intercambio X SwapX';

function gh() { return process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN_2 || ''; }
function ghHeaders() {
  return { Authorization: 'Bearer ' + gh(), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
}

async function loadSubs() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${SUBS_PATH}?ref=${BRANCH}`, { headers: ghHeaders() });
  if (r.status === 404) return { sha: null, subs: [] };
  if (!r.ok) throw new Error(`leer subs HTTP ${r.status}`);
  const j = await r.json();
  const body = Buffer.from(j.content, 'base64').toString('utf8');
  const data = JSON.parse(body || '{}');
  return { sha: j.sha, subs: Array.isArray(data.subs) ? data.subs : [] };
}

async function saveSubs(sha, subs) {
  const body = JSON.stringify({ subs }, null, 2);
  const put = await fetch(`https://api.github.com/repos/${REPO}/contents/${SUBS_PATH}`, {
    method: 'PUT',
    headers: ghHeaders(),
    body: JSON.stringify({ message: 'subs update (worldNotify)', branch: BRANCH, content: Buffer.from(body).toString('base64'), sha: sha || undefined })
  });
  if (!put.ok) throw new Error(`guardar subs HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`);
}

// envio a la campanita de World App (API oficial del Developer Portal)
async function worldSend(wallets, title, message) {
  const key = process.env.WORLD_API_KEY;
  const appId = process.env.WORLD_APP_ID;
  if (!key || !appId) throw new Error('falta WORLD_API_KEY o WORLD_APP_ID en Vercel');
  if (!Array.isArray(wallets) || wallets.length === 0) throw new Error('sin destinatarios');
  for (let i = 0; i < wallets.length; i += 1000) {
    const r = await fetch('https://developer.world.org/api/v2/minikit/send-notification', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        wallet_addresses: wallets.slice(i, i + 1000),
        title: String(title).slice(0, 30),
        message: String(message).slice(0, 200),
        mini_app_path: 'worldapp://mini-app?app_id=' + appId
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!j.success) throw new Error('World API: ' + JSON.stringify(j).slice(0, 180));
  }
}

// premios por volumen de intercambio (los paga Juan manualmente con sus comisiones)
function prizeTier(usd) {
  if (usd >= 500) return 0.30;
  if (usd >= 300) return 0.15;
  if (usd >= 200) return 0.10;
  if (usd >= 100) return 0.05;
  return 0;
}

let LAST_RETO_AT = 0;
const isWallet = (w) => /^0x[0-9a-fA-F]{40}$/.test(String(w || ''));
const cleanHandle = (h) => String(h || 'un jugador').replace(/[^A-Za-z0-9_@.]/g, '').slice(0, 28) || 'un jugador';

const wrap = require('./_cors');
module.exports = wrap(async (req, res) => {
  const body = req.body || {};
  const action = String(body.action || '').toLowerCase();

  if (action === 'count') {
    try { const { subs } = await loadSubs(); return res.json({ ok: true, count: subs.length }); }
    catch (e) { return res.json({ ok: true, count: 0, error: String(e) }); }
  }

  // suscribirse a notificaciones (tras aceptar el permiso en World App)
  if (action === 'subscribe') {
    const wallet = String(body.wallet || '').toLowerCase();
    if (!isWallet(wallet)) return res.status(400).json({ ok: false, error: 'wallet invalida' });
    const handle = cleanHandle(body.handle);
    try {
      const { sha, subs } = await loadSubs();
      const i = subs.findIndex((s) => s.wallet === wallet);
      if (i >= 0) { subs[i].handle = handle; subs[i].at = Date.now(); }
      else subs.push({ wallet, handle, at: Date.now() });
      if (subs.length > 5000) subs.splice(0, subs.length - 5000);
      await saveSubs(sha, subs);
      return res.json({ ok: true, count: subs.length });
    } catch (e) { return res.status(500).json({ ok: false, error: String(e) }); }
  }

  if (action === 'unsubscribe') {
    const wallet = String(body.wallet || '').toLowerCase();
    if (!isWallet(wallet)) return res.status(400).json({ ok: false, error: 'wallet invalida' });
    try {
      const { sha, subs } = await loadSubs();
      const filtered = subs.filter((s) => s.wallet !== wallet);
      if (filtered.length !== subs.length) await saveSubs(sha, filtered);
      return res.json({ ok: true, count: filtered.length });
    } catch (e) { return res.status(500).json({ ok: false, error: String(e) }); }
  }

  // premio por intercambio: aviso directo al que cambio (con su nombre via ${username})
  if (action === 'prize') {
    const wallet = String(body.wallet || '').toLowerCase();
    const usd = Number(body.usd) || 0;
    if (!isWallet(wallet)) return res.status(400).json({ ok: false, error: 'wallet invalida' });
    const prize = prizeTier(usd);
    if (!prize) return res.json({ ok: true, prize: 0 });
    const msg = '¡Hola ${username}! Intercambiaste $' + usd.toFixed(0) + ' y ganaste $' + prize.toFixed(2) + ' de regalo 🎉 Lo recibes en tu wallet.'
    try {
      await worldSend([wallet], '🎁 ¡Premio de ' + APP_LABEL + '!', msg);
      return res.json({ ok: true, prize: prize });
    } catch (e) { return res.status(500).json({ ok: false, error: String(e) }); }
  }

  // reto de damas nuevo: aviso a todos los suscritos (menos al creador del reto)
  if (action === 'reto') {
    const now = Date.now();
    if (now - LAST_RETO_AT < 60000) return res.json({ ok: true, skipped: true });
    LAST_RETO_AT = now;
    const handle = cleanHandle(body.handle);
    const stake = Number(body.stake) || 0;
    const from = String(body.fromWallet || '').toLowerCase();
    try {
      const { subs } = await loadSubs();
      const targets = subs.filter((s) => s.wallet !== from).map((s) => s.wallet);
      if (targets.length === 0) return res.json({ ok: true, sent: 0 });
      await worldSend(targets, '🐉 ¡Nuevo reto de Damas!', handle + ' abrió un reto de ' + stake + ' WLD 🐉 Entra y acepta el desafío.');
      return res.json({ ok: true, sent: targets.length });
    } catch (e) { return res.status(500).json({ ok: false, error: String(e) }); }
  }

  return res.status(400).json({ ok: false, error: 'accion desconocida' });
});
// redeploy 2026-10-08T15:42:54Z - tomar variables WORLD_*
