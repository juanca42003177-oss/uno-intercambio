// worldNotify (Vercel) — notificaciones push de World App (la campanita 🔔).
// Usa la API oficial del Developer Portal:
//   POST https://developer.world.org/api/v2/minikit/send-notification
// Variables de entorno necesarias (en Vercel):
//   WORLD_API_KEY  — API key creada en el Developer Portal (config de la app)
//   WORLD_APP_ID   — app_id de la mini app (app_xxxx)
//   GITHUB_TOKEN   — mismo token que usan priceAlerts/damasMoves
// Suscriptores: notify/subs-APP.json en la rama de datos del repo de GitHub.
// Volumen acumulado: notify/volumes-APP.json (mismo repo/rama). Cero Base44.
//
// PREMIOS POR VOLUMEN ACUMULADO (los paga Juan manualmente):
//   $100 -> $0.05 | $200 -> $0.10 | $300 -> $0.15 | $500 -> $0.30
//   Cada nivel se desbloquea UNA vez por wallet. El cliente suma cada swap
//   (>= $1) al volumen; el servidor avisa cuando se cruza un nivel nuevo.
//
// Anti-abuso: el servidor SOLO envia mensajes con plantillas fijas (prize / reto);
// nadie desde fuera puede mandar texto arbitrario a los usuarios, y el aviso de
// retos esta limitado a 1 por minuto por instancia.

const BRANCH = 'alerts-data'; // rama de datos del repo
const REPO = process.env.GITHUB_ALERTS_REPO || 'juanca42003177-oss/uno-intercambio';
const SUBS_PATH = 'notify/subs-swapx.json';
const VOL_PATH = 'notify/volumes-swapx.json';
const APP_LABEL = 'Intercambio X SwapX';

// niveles de premio por volumen acumulado (usd alcanzado -> regalo)
const TIERS = [
  { usd: 50, prize: 0.03 },
  { usd: 100, prize: 0.05 },
  { usd: 200, prize: 0.10 },
  { usd: 300, prize: 0.15 },
  { usd: 500, prize: 0.30 }
];

function gh() { return process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN_2 || ''; }
function ghHeaders() {
  return { Authorization: 'Bearer ' + gh(), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
}

async function loadFile(path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`, { headers: ghHeaders() });
  if (r.status === 404) return { sha: null, data: null };
  if (!r.ok) throw new Error(`leer ${path} HTTP ${r.status}`);
  const j = await r.json();
  const body = Buffer.from(j.content, 'base64').toString('utf8');
  return { sha: j.sha, data: JSON.parse(body || 'null') };
}

async function saveFile(path, sha, data, msg) {
  const body = JSON.stringify(data, null, 2);
  const put = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: ghHeaders(),
    body: JSON.stringify({ message: msg, branch: BRANCH, content: Buffer.from(body).toString('base64'), sha: sha || undefined })
  });
  if (!put.ok) throw new Error(`guardar ${path} HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`);
}

async function loadSubs() {
  const { sha, data } = await loadFile(SUBS_PATH);
  return { sha, subs: Array.isArray(data && data.subs) ? data.subs : [] };
}

async function saveSubs(sha, subs) {
  await saveFile(SUBS_PATH, sha, { subs }, 'subs update (worldNotify)');
}

async function loadVols() {
  const { sha, data } = await loadFile(VOL_PATH);
  const vols = (data && Array.isArray(data.vols)) ? data.vols : [];
  return { sha, vols };
}

async function saveVols(sha, vols) {
  if (vols.length > 20000) vols.splice(0, vols.length - 20000);
  await saveFile(VOL_PATH, sha, { vols }, 'volumes update (worldNotify)');
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

let LAST_RETO_AT = 0;
const isWallet = (w) => /^0x[0-9a-fA-F]{40}$/.test(String(w || ''));
const cleanHandle = (h) => String(h || 'un jugador').replace(/[^A-Za-z0-9_@.]/g, '').slice(0, 28) || 'un jugador';

// aviso a Telegram (mismo bot/chat que notifySwap) para que Juan pague el premio.
// Sin TELEGRAM_BOT_TOKEN simplemente no se envia; la campanita ya aviso igual.
async function tgSend(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: 8022768138, text: text })
    });
  } catch (e) {}
}

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

  // consultar mi volumen acumulado y el proximo premio (para la barra de progreso)
  if (action === 'volume') {
    const wallet = String(body.wallet || '').toLowerCase();
    if (!isWallet(wallet)) return res.status(400).json({ ok: false, error: 'wallet invalida' });
    try {
      const { vols } = await loadVols();
      const me = vols.find((v) => v.wallet === wallet);
      const volume = (me && Number(me.usd)) || 0;
      const claimed = (me && Array.isArray(me.claimed) && me.claimed) || [];
      const next = TIERS.find((t) => !claimed.includes(t.usd));
      return res.json({ ok: true, volume: volume, claimed: claimed, next: next ? { usd: next.usd, prize: next.prize } : null, tiers: TIERS });
    } catch (e) { return res.status(500).json({ ok: false, error: String(e) }); }
  }

  // sumar un swap al volumen acumulado; avisar si se desbloquea un nivel nuevo
  if (action === 'prize') {
    const wallet = String(body.wallet || '').toLowerCase();
    const usd = Number(body.usd) || 0;
    if (!isWallet(wallet)) return res.status(400).json({ ok: false, error: 'wallet invalida' });
    if (usd < 0.01 || usd > 100000) return res.json({ ok: true, volume: 0, prize: 0 });
    try {
      const { sha, vols } = await loadVols();
      let me = vols.find((v) => v.wallet === wallet);
      if (!me) { me = { wallet, usd: 0, claimed: [], at: Date.now() }; vols.push(me); }
      const before = me.usd || 0;
      me.usd = before + usd;
      me.at = Date.now();
      if (!Array.isArray(me.claimed)) me.claimed = [];
      const unlocked = TIERS.filter((t) => before < t.usd && me.usd >= t.usd && !me.claimed.includes(t.usd));
      const newPrize = unlocked.reduce((s, t) => s + t.prize, 0);
      unlocked.forEach((t) => me.claimed.push(t.usd));
      if (me.claimed.length === TIERS.length) me.done = true;
      await saveVols(sha, vols);
      if (unlocked.length > 0) {
        const msg = '¡Hola ${username}! Ya intercambiaste $' + me.usd.toFixed(2) + ' acumulado en ' + APP_LABEL + ' 🎉 Desbloqueaste $' + newPrize.toFixed(2) + ' de regalo. Lo recibes en tu wallet.';
        await worldSend([wallet], '🎁 ¡Premio de ' + APP_LABEL + '!', msg);
        // extra para Juan: nombre de usuario + cuenta del ganador para pagar a mano
        const handle = cleanHandle(body.handle);
        tgSend('💠 Intercambio X SwapX / 🎁 Premio por volumen\n' + (handle ? handle + ' — ' : '') + wallet + '\nllegó a $' + me.usd.toFixed(2) + ' acumulados → pagar $' + newPrize.toFixed(2)).catch(function(){});
      }
      return res.json({ ok: true, volume: me.usd, prize: newPrize, unlocked: unlocked.map((t) => t.usd) });
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
      await worldSend(targets, '🔔 ¡Aviso de SwapX!', handle + ' abrió un reto de ' + stake + ' WLD 🐉 Entra y acepta el desafío.');
      return res.json({ ok: true, sent: targets.length });
    } catch (e) { return res.status(500).json({ ok: false, error: String(e) }); }
  }

  return res.status(400).json({ ok: false, error: 'accion desconocida' });
});
