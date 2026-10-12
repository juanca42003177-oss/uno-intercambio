// damasMoves (Vercel) — relay de jugadas de Damas entre los 2 navegadores.
// Persistencia: un archivo game-<id>.json por partida en la rama 'damas-data'
// del repo de GitHub (mismo patron que alerts.json de priceAlerts: via API,
// no raw, para no servir contenido viejo por cache CDN).
// No es un bot ni corre solo: solo responde cuando un jugador llama.
// Acciones: move (agregar jugada o firma de resultado) | state (leer log).

const rules = require('./_damasRules');
const BRANCH = 'damas-data';
const EMOTES = ['👏', '😂', '😮', '😭', '😡', '🔥', '🐉', '👍'];
const REPO = process.env.GITHUB_ALERTS_REPO || 'juanca42003177-oss/Uno-Intercambio-Prueba';

function gh() { return process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN_2 || ''; }

function pathFor(gameId) { return `damas/game-${gameId}.json`; }

async function loadGame(gameId) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${pathFor(gameId)}?ref=${BRANCH}`, {
    headers: { Authorization: `token ${gh()}`, Accept: 'application/vnd.github.raw+json' },
  });
  if (r.status === 404) return { log: [] };
  if (!r.ok) throw new Error(`leer game-${gameId}.json HTTP ${r.status}`);
  return await r.json();
}

async function saveGame(gameId, data) {
  const api = `https://api.github.com/repos/${REPO}/contents/${pathFor(gameId)}`;
  const cur = await fetch(`${api}?ref=${BRANCH}`, { headers: { Authorization: `token ${gh()}` } });
  let sha = null;
  if (cur.ok) sha = (await cur.json()).sha;
  const body = {
    message: `damas ${gameId} ${new Date().toISOString()}`,
    branch: BRANCH,
    content: Buffer.from(JSON.stringify(data, null, 1)).toString('base64'),
  };
  if (sha) body.sha = sha;
  const put = await fetch(api, {
    method: 'PUT',
    headers: { Authorization: `token ${gh()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!put.ok) throw new Error(`guardar game-${gameId}.json HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`);
  return true;
}

const wrap = require('./_cors');
module.exports = wrap(async (req, res) => {
  const body = req.method === 'GET' ? (req.query || {}) : (req.body || {});
  const action = String(body.action || 'state').toLowerCase();
  const gameId = String(body.gameId || '');
  if (!gameId) return res.status(400).json({ ok: false, error: 'falta gameId' });

  let data;
  try { data = await loadGame(gameId); } catch (e) {
    return res.status(500).json({ ok: false, error: 'almacenamiento: ' + String(e) });
  }
  if (!Array.isArray(data.log)) data.log = [];

  // ---- leer el log completo (polling del rival) ----
  if (action === 'state') {
    return res.json({ ok: true, log: data.log, emotes: Array.isArray(data.emotes) ? data.emotes : [], drawProposal: data.drawProposal || null });
  }

  // ---- emojis estilo Clash entre jugadores (no tocan el log de jugadas) ----
  if (action === 'emote') {
    const emote = String(body.emote || body.e || '');
    const by = String(body.by || '').slice(0, 44);
    if (!EMOTES.includes(emote)) return res.status(400).json({ ok: false, error: 'emote no valido' });
    if (!Array.isArray(data.emotes)) data.emotes = [];
    const last = data.emotes[data.emotes.length - 1];
    if (last && Date.now() - last.ts < 1500) {
      return res.json({ ok: true, throttled: true, emotes: data.emotes });
    }
    data.emotes.push({ by, emote, ts: Date.now() });
    if (data.emotes.length > 40) data.emotes = data.emotes.slice(-40);
    try { await saveGame(gameId, data); } catch (e) {
      return res.status(500).json({ ok: false, error: 'guardar: ' + String(e) });
    }
    return res.json({ ok: true, emotes: data.emotes });
  }


  // ---- tablas (empate): proponer y responder, sin tocar el log ----
  if (action === 'proposedraw') {
    const by = String(body.by || '');
    if (by !== 'p1' && by !== 'p2') return res.status(400).json({ ok: false, error: 'bando invalido' });
    const now = Date.now();
    if (data.drawProposal) {
      const p = data.drawProposal;
      if (p.by === by && p.status === 'proposed' && now - p.ts < 3600000) {
        return res.json({ ok: true, drawProposal: p });
      }
      if (p.status === 'proposed' && p.by !== by) {
        return res.status(400).json({ ok: false, error: 'ya hay una propuesta de tablas pendiente' });
      }
    }
    data.drawProposal = { by, ts: now, status: 'proposed' };
    try { await saveGame(gameId, data); } catch (e) {
      return res.status(500).json({ ok: false, error: 'guardar: ' + String(e) });
    }
    return res.json({ ok: true, drawProposal: data.drawProposal });
  }

  if (action === 'responddraw') {
    const by = String(body.by || '');
    const accept = !!body.accept;
    if (by !== 'p1' && by !== 'p2') return res.status(400).json({ ok: false, error: 'bando invalido' });
    if (!data.drawProposal || data.drawProposal.status !== 'proposed') {
      return res.status(400).json({ ok: false, error: 'no hay propuesta de tablas pendiente' });
    }
    if (data.drawProposal.by === by) return res.status(400).json({ ok: false, error: 'no puedes responder tu propia propuesta' });
    data.drawProposal = accept ? { by: data.drawProposal.by, ts: Date.now(), status: 'accepted' } : null;
    try { await saveGame(gameId, data); } catch (e) {
      return res.status(500).json({ ok: false, error: 'guardar: ' + String(e) });
    }
    return res.json({ ok: true, drawProposal: data.drawProposal || null });
  }

  // ---- agregar una entrada: jugada o firma de resultado ----
  if (action === 'move') {
    const { entry } = body;
    if (!entry || typeof entry !== 'object') return res.status(400).json({ ok: false, error: 'falta entry' });
    const idx = Number(body.idx);
    if (!isFinite(idx) || idx !== data.log.length) {
      // ya existe esa jugada o llego fuera de orden: devolver el log real
      // para que el cliente se resincronice en vez de duplicar.
      return res.json({ ok: true, conflict: true, log: data.log });
    }
    // ---- VALIDACION ANTI-TRAMPA: solo se aceptan jugadas legales y en turno ----
    if (entry.type === 'move') {
      const by = entry.by;
      if (by !== 'p1' && by !== 'p2') return res.status(400).json({ ok: false, error: 'bando invalido' });
      const rb = rules.damasRebuild(data.log);
      if (rb.turn !== by) return res.status(400).json({ ok: false, error: 'no es tu turno' });
      const mv = entry.move;
      const legales = rules.damasLegalMoves(rb.board, by);
      const ok = mv && legales.some((l) => l.from === mv.from && l.to === mv.to &&
        JSON.stringify(l.captures || []) === JSON.stringify(mv.captures || []));
      if (!ok) return res.status(400).json({ ok: false, error: 'jugada ilegal' });
      // guardar solo los campos conocidos (nada de datos extra del cliente)
      data.log.push({ type: 'move', move: { from: mv.from, to: mv.to, captures: mv.captures || [] }, by, ts: Date.now() });
    } else {
      return res.status(400).json({ ok: false, error: 'tipo de entrada no permitido' });
    }
    try { await saveGame(gameId, data); } catch (e) {
      return res.status(500).json({ ok: false, error: 'guardar: ' + String(e) });
    }
    return res.json({ ok: true, log: data.log });
  }

  return res.status(400).json({ ok: false, error: 'accion desconocida' });
});
