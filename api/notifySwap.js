// notifySwap — notificación de Telegram desde Vercel (el token NUNCA llega al navegador).
// Requiere la variable de entorno TELEGRAM_BOT_TOKEN en Vercel.
const CHAT_ID = '8022768138';
let recent = [];

function rateLimited() {
  const now = Date.now();
  recent = recent.filter((t) => now - t < 60000);
  if (recent.length >= 20) return true;
  recent.push(now);
  return false;
}
function formatMonto(n) { return Number.isInteger(n) ? String(n) : n.toFixed(2); }
function buildText(app, kind, prefix, amt, wallet, extra) {
  let body;
  if (kind === 'vault') body = `${prefix}depositó $${amt} en ${extra} ${wallet}`;
  else if (kind === 'bet') body = `${prefix}apostó $${amt} a ${extra} ${wallet}`;
  else body = `${prefix}intercambio $${amt} ${wallet}` + (extra ? `\n💰 Comisión: ${extra}` : '');
  if (app === 'dragon') {
    const label = kind === 'vault' ? 'Bóveda' : kind === 'bet' ? 'Predicción' : 'Intercambio';
    return `🐉 Dragon Trade — ${label}\n${body}`;
  }
  if (app === 'swapx') {
    const label = kind === 'vault' ? 'Bóveda' : 'Intercambio';
    return `💠 Intercambio X SwapX — ${label}\n${body}`;
  }
  return body;
}

const wrap = require('./_cors');
module.exports = wrap(async (req, res) => {
  const body = req.body || {};
  const montoUsd = Number(body.montoUsd);
  const wallet = String(body.wallet || '').toLowerCase();
  const handle = String(body.handle || '').replace(/^@/, '');
  const app = String(body.app || '').toLowerCase();
  const kind = String(body.kind || 'swap').toLowerCase();
  const extra = String(body.extra || '');

  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet inválida' });
  if (!isFinite(montoUsd) || montoUsd < 0 || montoUsd > 100000000) return res.status(400).json({ error: 'monto inválido' });
  if (rateLimited()) return res.status(429).json({ error: 'demasiadas notificaciones' });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(200).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN no configurado en Vercel' });

  const prefix = handle ? '@' + handle + ' ' : '';
  const text = buildText(app, kind, prefix, formatMonto(montoUsd), wallet, extra);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text }),
    });
    const j = await r.json();
    if (j && j.ok) return res.status(200).json({ ok: true });
    return res.status(200).json({ ok: false, error: 'Telegram rechazó el envío' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
});
