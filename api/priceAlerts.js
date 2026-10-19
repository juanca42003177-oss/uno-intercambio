// priceAlerts — Alertas de precio de Intercambio X SwapX (port a Vercel).
// Persistencia: archivo alerts.json en la rama 'alerts-data' del repo de GitHub
// (via API, gratis, no toca main para no disparar deploys).
// Acciones: create | list | cancel | config | test | tick (cron cada 5 min).

const ALERTS_PATH = 'alerts.json';
const ALERTS_BRANCH = 'alerts-data';
const REPO = process.env.GITHUB_DATA_REPO || 'juanca42003177-oss/dragon-labs-data';
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

// campanita de World App: aviso de alerta cumplida (si el usuario se suscribio)
let lastAlertReason = '';
async function worldAlert(wallet, message) {
  const key = process.env.WORLD_API_KEY;
  const appId = process.env.WORLD_APP_ID;
  if (!key || !appId || !wallet) return false;
  try {
    const r = await fetch('https://developer.world.org/api/v2/minikit/send-notification', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: appId, wallet_addresses: [wallet],
        title: '🔔 Alerta de precio', message: String(message).slice(0, 200),
        mini_app_path: 'worldapp://mini-app?app_id=' + appId
      })
    });
    const j = await r.json().catch(() => ({}));
    const one = Array.isArray(j && j.result) ? j.result[0] : null;
    lastAlertReason = one ? (one.sent ? 'enviada' : (one.reason || 'rechazada')) : (j && j.success ? 'ok' : 'sin respuesta');
    return !!(j && j.success && (!one || one.sent));
  } catch (e) { lastAlertReason = 'error: ' + String(e).slice(0, 60); return false; }
}

async function fetchPrices() {
  // URL publica estable (VERCEL_URL es un dominio interno protegido que puede devolver HTML)
  const hosts = ['https://intercambiox.vercel.app'];
  if (process.env.VERCEL_URL) hosts.push('https://' + process.env.VERCEL_URL);
  let lastErr = '';
  for (const h of hosts) {
    try {
      const r = await fetch(h + '/api/getMarketPrices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const j = await r.json();
      if (j && j.prices && Object.keys(j.prices).length > 0) return j.prices;
      lastErr = h + ' sin precios';
    } catch (e) { lastErr = h + ': ' + String(e).slice(0, 80); }
  }
  throw new Error(lastErr);
}

let LAST_TICK_AT = 0; // candado por instancia (evita doble envio si cron y app coinciden)
const wrap = require('./_cors');

// ---------- grabador de historial de precios (graficos de monedas exoticas) ----------
const HIST_PATH = 'history/prices.json';
async function maybeSnapHistory(prices) {
  try {
    // incluir tambien los precios de Dragon Trade (CHAD y demas)
    try {
      const r2 = await fetch('https://dragontrade.vercel.app/api/getMarketPrices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j2 = await r2.json();
      if (j2 && j2.prices) for (const [s2, p2] of Object.entries(j2.prices)) prices[s2] = p2;
    } catch (e) {}
    const getr = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + HIST_PATH, {
      headers: { Authorization: 'Bearer ' + gh(), Accept: 'application/vnd.github+json' },
    });
    let data = {};
    let sha = null;
    if (getr.ok) {
      const j = await getr.json();
      sha = j.sha;
      try { data = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8') || '{}'); } catch (e) { data = {}; }
    }
    const now = Date.now();
    let changed = false;
    for (const [sym, p] of Object.entries(prices)) {
      if (!(p > 0)) continue;
      const arr = data[sym] || [];
      if (!arr.length || now - arr[arr.length - 1][0] >= 240000) {
        arr.push([now, p]);
        if (arr.length > 2016) arr.shift(); // 7 dias de puntos a 5 min
        data[sym] = arr;
        changed = true;
      }
    }
    if (changed) await ghSave(HIST_PATH, sha, data, 'history: snapshot de precios');
  } catch (e) { /* silencioso: nunca romper el tick por el historial */ }
}

// ---------- reparto semanal de la racha (domingos por la noche GT) ----------
const STREAK_PATH = 'notify/streak-swapx.json';
const VOL_PATH = 'notify/volumes-swapx.json';
const USDC_CONTRACT = '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1';
const { payPrizeUsdc } = require('./_prizePay');

async function ghLoad(path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${ALERTS_BRANCH}`, {
    headers: { Authorization: 'Bearer ' + gh(), Accept: 'application/vnd.github+json' },
  });
  if (r.status === 404) return { sha: null, data: null };
  if (!r.ok) throw new Error('leer ' + path + ' HTTP ' + r.status);
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8') || 'null') };
}
async function ghSave(path, sha, data, msg) {
  const put = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + gh(), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, branch: ALERTS_BRANCH, content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'), sha: sha || undefined }),
  });
  if (!put.ok) throw new Error('guardar ' + path + ' HTTP ' + put.status);
}
function streakWeekKey(ms) {
  const t = new Date(ms || Date.now());
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day);
  const y = t.getUTCFullYear();
  const first = new Date(Date.UTC(y, 0, 1));
  const week = Math.ceil((((t - first) / 86400000) + first.getUTCDay() + 1) / 7);
  return y + '-W' + week;
}
async function prizeWalletUsdcBalance() {
  try {
    const { prizeWalletAddress } = require('./_prizePay');
    const from = await prizeWalletAddress();
    const r = await fetch('https://worldchain-mainnet.g.alchemy.com/public', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: USDC_CONTRACT, data: '0x70a08231' + from.slice(2).padStart(64, '0') }, 'latest'] }),
    });
    const j = await r.json();
    return Number(BigInt(j.result || '0x0')) / 1e6;
  } catch (e) { return -1; }
}
async function maybeStreakDraw() {
  // se reparte el lunes temprano UTC = domingo por la noche en Guatemala
  const now = new Date();
  if (now.getUTCDay() !== 1 || now.getUTCHours() >= 6) return;
  const wk = streakWeekKey(Date.now() - 3 * 86400000); // la semana que termina
  const { sha, data } = await ghLoad(STREAK_PATH);
  const s = (data && typeof data === 'object') ? data : {};
  if (!s.weeks) s.weeks = {};
  const wkData = s.weeks[wk] || {};
  if (wkData.done) return;
  if (!wkData.tickets || Object.keys(wkData.tickets).length === 0) { s.weeks[wk] = Object.assign({}, wkData, { done: true, pot: 0 }); await ghSave(STREAK_PATH, sha, s, 'streak: semana sin tickets'); return; }
  const { data: volsData } = await ghLoad(VOL_PATH);
  const vols = (volsData && Array.isArray(volsData.vols)) ? volsData.vols : [];
  const curSum = vols.reduce((a, v) => a + (Number(v.usd) || 0), 0);
  if (typeof s.lastVolSum !== 'number') {
    s.lastVolSum = curSum;
    await ghSave(STREAK_PATH, sha, s, 'streak: calibracion inicial de linea base');
    return; // primera vez: no hay historial de semana, no se reparte
  }
  const weeklyVolume = Math.max(0, curSum - (s.lastVolSum || 0));
  const potTarget = weeklyVolume * 0.003 * 0.6; // 60% de las comisiones estimadas (0.3%)
  const balance = await prizeWalletUsdcBalance();
  if (balance < 0) return; // RPC fallo: reintenta en el proximo tick
  let pot = Math.min(potTarget, balance);
  if (potTarget < 0.10) {
    if (!wkData.warned) {
      await tg('sendMessage', { chat_id: OFFICIAL_CHAT, text: ALERT_PREFIX + ' / 🔥 Racha semanal\nSemana sin volumen: no hay pozo que repartir. Los tickets de esta semana siguen para el próximo domingo con actividad.' }).catch(function(){});
    }
    s.weeks[wk] = Object.assign({}, wkData, { done: true, pot: 0, warned: true });
    s.lastVolSum = curSum;
    await ghSave(STREAK_PATH, sha, s, 'streak: semana sin volumen, sin reparto');
    return;
  }
  if (pot < 0.10) {
    // no marcar done: si la caja se rellena durante la noche, el proximo tick paga esta misma semana
    if (!wkData.warned) {
      await tg('sendMessage', { chat_id: OFFICIAL_CHAT, text: ALERT_PREFIX + ' / 🔥 Racha semanal\nPozo de esta semana: $' + potTarget.toFixed(2) + ' USDC, pero la caja de premios tiene $' + balance.toFixed(2) + '.\nManda el faltante a la wallet de premios y el sistema reparte solo esta misma noche.' }).catch(function(){});
    }
    s.weeks[wk] = Object.assign({}, wkData, { warned: true, potTarget: potTarget });
    await ghSave(STREAK_PATH, sha, s, 'streak: caja insuficiente, esperando fondos');
    return;
  }
  const tickets = wkData.tickets;
  const totalTickets = Object.values(tickets).reduce((a, b) => a + b, 0);
  const pagos = [];
  for (const entry of Object.entries(tickets).slice(0, 15)) {
    const share = Math.floor(pot * (entry[1] / totalTickets) * 100) / 100;
    if (share < 0.01) continue;
    const pago = await payPrizeUsdc(entry[0], share);
    pagos.push({ wallet: entry[0], tickets: entry[1], usd: share, ok: pago.ok, tx: pago.tx || pago.reason });
  }
  const pagado = pagos.filter(function (p) { return p.ok; }).reduce(function (a, p) { return a + p.usd; }, 0);
  s.weeks[wk] = Object.assign({}, wkData, { done: true, pot: pot, paid: pagos, totalTickets: totalTickets });
  s.lastVolSum = curSum;
  await ghSave(STREAK_PATH, sha, s, 'streak: reparto semanal ' + wk);
  await tg('sendMessage', {
    chat_id: OFFICIAL_CHAT,
    text: ALERT_PREFIX + ' / 🔥 Reparto semanal de la racha (' + wk + ')\nPozo: $' + pot.toFixed(2) + ' USDC (volumen de la semana: $' + weeklyVolume.toFixed(2) + ')\nGanadores: ' + pagos.length + ' | tickets: ' + totalTickets + '\nPagado automáticamente: $' + pagado.toFixed(2),
  }).catch(function(){});
}

module.exports = wrap(async (req, res) => {
  const body = req.body || {};
  const action = String(body.action || 'tick').toLowerCase();

  // reparto semanal de la racha: se autodispara dentro de la ventana del domingo-noche
  if (action === 'tick') { try { await maybeStreakDraw(); } catch (e) { try { await tg('sendMessage', { chat_id: OFFICIAL_CHAT, text: ALERT_PREFIX + ' / 🔥 Error en reparto de racha: ' + String((e && e.message) || e) }); } catch (e2) {} } }
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
      wallet: /^0x[0-9a-fA-F]{40}$/.test(String(body.wallet || '')) ? String(body.wallet).toLowerCase() : '',
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

  // ---- tick (cron cada 5 min + la propia app cada ~45s) ----
  if (action === 'tick') {
    // candado por instancia: si otro tick corrio hace menos de 40s, no repetir
    // (evita enviar dos veces la misma alerta cuando cron y app coinciden)
    if (now - LAST_TICK_AT < 40000) return res.json({ ok: true, skipped: true });
    LAST_TICK_AT = now;
    const log = { linked: 0, triggered: 0, expired: 0, errors: [] };
    try { const hp = await fetchPrices(); await maybeSnapHistory(hp); } catch (e) { try { log.errors.push('history ' + String(e).slice(0, 60)); } catch (e2) {} }
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
        // sin Telegram NI wallet suscrita a la campanita: no hay a quien avisar
        if (!a.chatId && !a.wallet) {
          if (now - a.created > 7 * 86400000) { a.status = 'expirada'; log.expired++; dirty = true; }
          continue;
        }
        const verb = a.direction === 'arriba' ? 'subió hasta' : 'bajó hasta';
        const txt = `${ALERT_PREFIX} — Alerta\n${a.sym} ${verb} $${fmtPrice(cur)} 🎯\nTu alerta era $${fmtPrice(a.price)}.\nVuelve a la app para intercambiar.`;
        let avisada = false;
        if (a.chatId) {
          try {
            const r = await tg('sendMessage', { chat_id: a.chatId, text: txt });
            if (r && r.ok) avisada = true;
          } catch (e) { log.errors.push(`alerta ${a.id}: ` + String(e)); }
        }
        // campanita de World App (canal adicional, independiente del Telegram)
        const worldTxt = `${a.sym} ${verb} $${fmtPrice(cur)} 🎯 Tu alerta se cumplió. Vuelve a la app.`;
        const worldOk = await worldAlert(a.wallet, worldTxt);
        log.errors.push('campanita ' + a.sym + ': ' + lastAlertReason);
        if (avisada || worldOk) { a.status = 'avisada'; a.triggeredAt = now; log.triggered++; dirty = true; }
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
