// priceAlerts — Alertas de precio de Intercambio X SwapX (port a Vercel).
// Persistencia: archivo alerts.json en la rama 'alerts-data' del repo de GitHub
// (via API, gratis, no toca main para no disparar deploys).
// Acciones: create | list | cancel | config | test | tick (cron cada 5 min).

const ALERTS_PATH = 'alerts.json';
const ALERTS_BRANCH = 'alerts-data';
const REPO = process.env.GITHUB_ALERTS_REPO || 'juanca42003177-oss/uno-intercambio';
const OFFICIAL_CHAT = '8022768138';
const ALERT_PREFIX = '💠 Intercambio X SwapX';

function gh() { return process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN_2 || ''; }
function tg(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN no configurado');
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
}

function code6() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
function fmtPrice(v) {
  if (!isFinite(v)) return '?';
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

// ---- persistencia en GitHub (alerts-data/alerts.json) ----
async function loadAlertsFile() {
  // via API (no raw.githubusercontent): el raw tiene cache CDN que sirve 404
  // viejos justo despues de crear el archivo y las alertas parecen perderse.
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${ALERTS_PATH}?ref=${ALERTS_BRANCH}`, {
    headers: { Authorization: `token ${gh()}`, Accept: 'application/vnd.github.raw+json' },
  });
  if (r.status === 404) return { alerts: [] };
  if (!r.ok) throw new Error(`leer alerts.json HTTP ${r.status}`);
  return await r.json();
}

async function saveAlertsFile(data) {
  const api = `https://api.github.com/repos/${REPO}/contents/${ALERTS_PATH}`;
  const cur = await fetch(`${api}?ref=${ALERTS_BRANCH}`, { headers: { Authorization: `token ${gh()}` } });
  let sha = null;
  if (cur.ok) sha = (await cur.json()).sha;
  const body = {
    message: 'alertas ' + new Date().toISOString(),
    branch: ALERTS_BRANCH,
    content: Buffer.from(JSON.stringify(data, null, 1)).toString('base64'),
  };
  if (sha) body.sha = sha;
  const put = await fetch(api, {
    method: 'PUT',
    headers: { Authorization: `token ${gh()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!put.ok) throw new Error(`guardar alerts.json HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`);
  return true;
}

// ---- vinculación de sesiones por código con el bot de Telegram ----
async function linkPendingSessions(data) {
  let linked = 0;
  let res;
  try { res = await tg('getUpdates', { limit: 100, timeout: 0 }); } catch { return linked; }
  const updates = (res && res.ok && Array.isArray(res.result)) ? res.result : [];
  if (updates.length === 0) return linked;
  let maxId = 0;
  for (const u of updates) {
    if (u.update_id > maxId) maxId = u.update_id;
    const msg = u.message || u.channel_post;
    const text = (msg && msg.text) || '';
    const m = text.toUpperCase().match(/[A-Z0-9]{6}/g) || [];
    for (const raw of m) {
      const pend = data.alerts.filter((a) => a.code === raw && !a.chatId && a.status === 'activa');
      if (pend.length > 0 && msg && msg.chat) {
        const chatId = String(msg.chat.id);
        const sessionKey = pend[0].sessionKey;
        for (const a of data.alerts) {
          if (a.sessionKey === sessionKey && !a.chatId) { a.chatId = chatId; linked++; }
        }
        try {
          await tg('sendMessage', {
            chat_id: chatId,
            text: `${ALERT_PREFIX}\n✅ Telegram vinculado. Te avisaremos cuando tus alertas de precio se cumplan.`,
          });
        } catch { /* no crítico */ }
      }
    }
  }
  try { await tg('getUpdates', { offset: maxId + 1, limit: 1, timeout: 0 }); } catch { /* no crítico */ }
  return linked;
}

async function fetchPrices() {
  const r = await fetch(`http://${process.env.VERCEL_URL || 'intercambiox.vercel.app'}/api/getMarketPrices`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const j = await r.json();
  return (j && j.prices) || {};
}

const wrap = require('./_cors');
module.exports = wrap(async (req, res) => {
  const body = req.body || {};
  const action = String(body.action || 'tick').toLowerCase();
  const now = Date.now();
  let data;
  try { data = await loadAlertsFile(); } catch (e) {
    return res.status(500).json({ ok: false, error: 'almacenamiento: ' + String(e) });
  }
  if (!Array.isArray(data.alerts)) data.alerts = [];

  // ---- config: usuario del bot ----
  if (action === 'config') {
    try {
      const me = await tg('getMe', {});
      return res.json({ ok: true, bot: me && me.result ? me.result.username : null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  }

  // ---- test ----
  if (action === 'test') {
    await tg('sendMessage', {
      chat_id: OFFICIAL_CHAT,
      text: `${ALERT_PREFIX} — Alerta\nWLD llegó a $0.40 (subió) 🔔\n(Mensaje de prueba del sistema de alertas)`,
    });
    return res.json({ ok: true });
  }

  // ---- crear ----
  if (action === 'create') {
    const { sym, price, direction, sessionKey } = body;
    const p = Number(price);
    if (!sym || !sessionKey || !isFinite(p) || p <= 0 || (direction !== 'arriba' && direction !== 'abajo')) {
      return res.status(400).json({ ok: false, error: 'datos incompletos' });
    }
    const mine = data.alerts.filter((a) => a.sessionKey === sessionKey);
    if (mine.filter((a) => a.status === 'activa').length >= 10) {
      return res.status(400).json({ ok: false, error: 'máximo 10 alertas activas' });
    }
    const linked = mine.find((a) => a.chatId && a.status !== 'expirada');
    const rec = {
      id: 'a' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      sym: String(sym), price: p, direction, sessionKey: String(sessionKey),
      handle: body.handle ? String(body.handle) : '', code: code6(),
      chatId: linked ? linked.chatId : '', status: 'activa', created: now,
    };
    data.alerts.push(rec);
    try { await saveAlertsFile(data); } catch (e) {
      return res.status(500).json({ ok: false, error: 'guardar: ' + String(e) });
    }
    return res.json({ ok: true, id: rec.id, code: rec.code, linked: !!linked });
  }

  // ---- listar ----
  if (action === 'list') {
    const out = data.alerts
      .filter((a) => a.sessionKey === String(body.sessionKey || '') && a.status !== 'expirada')
      .sort((x, y) => x.created - y.created)
      .map((a) => ({ id: a.id, sym: a.sym, price: a.price, direction: a.direction, status: a.status, linked: !!a.chatId }));
    return res.json({ ok: true, alerts: out });
  }

  // ---- cancelar ----
  if (action === 'cancel') {
    const a = data.alerts.find((x) => x.id === String(body.id || '') && x.sessionKey === String(body.sessionKey || ''));
    if (!a) return res.status(404).json({ ok: false, error: 'no encontrada' });
    a.status = 'expirada';
    try { await saveAlertsFile(data); } catch (e) {
      return res.status(500).json({ ok: false, error: 'guardar: ' + String(e) });
    }
    return res.json({ ok: true });
  }

  // ---- tick (cron cada 5 min) ----
  if (action === 'tick') {
    const log = { linked: 0, triggered: 0, expired: 0, errors: [] };
    let dirty = false;
    try {
      const linked = await linkPendingSessions(data);
      if (linked > 0) { log.linked = linked; dirty = true; }
    } catch (e) { log.errors.push('link: ' + String(e)); }

    let prices = {};
    try { prices = await fetchPrices(); } catch (e) { log.errors.push('prices: ' + String(e)); }

    if (Object.keys(prices).length > 0) {
      for (const a of data.alerts) {
        if (a.status !== 'activa') continue;
        const cur = prices[a.sym];
        if (!cur || !isFinite(cur) || cur <= 0) continue;
        const hit = (a.direction === 'arriba' && cur >= a.price) || (a.direction === 'abajo' && cur <= a.price);
        if (!hit) continue;
        if (!a.chatId) {
          if (now - a.created > 7 * 86400000) { a.status = 'expirada'; log.expired++; dirty = true; }
          continue;
        }
        const verb = a.direction === 'arriba' ? 'subió hasta' : 'bajó hasta';
        const txt = `${ALERT_PREFIX} — Alerta\n${a.sym} ${verb} $${fmtPrice(cur)} 🎯\nTu alerta era $${fmtPrice(a.price)}.\nVuelve a la app para intercambiar.`;
        try {
          const r = await tg('sendMessage', { chat_id: a.chatId, text: txt });
          if (r && r.ok) { a.status = 'avisada'; a.triggeredAt = now; log.triggered++; dirty = true; }
        } catch (e) { log.errors.push(`alerta ${a.id}: ` + String(e)); }
      }
    }
    // limpieza: avisadas/expiradas con más de 30 días fuera
    const before = data.alerts.length;
    data.alerts = data.alerts.filter((a) => {
      if (a.status === 'avisada' || a.status === 'expirada') return now - (a.triggeredAt || a.created) < 30 * 86400000;
      return true;
    });
    if (data.alerts.length !== before) dirty = true;

    if (dirty) {
      try { await saveAlertsFile(data); } catch (e) { log.errors.push('guardar: ' + String(e)); }
    }
    return res.json({ ok: true, ...log });
  }

  return res.status(400).json({ ok: false, error: 'acción desconocida' });
});
