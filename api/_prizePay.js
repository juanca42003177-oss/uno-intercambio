// _prizePay.js — pago automatico de premios por volumen, en USDC (World Chain).
// Usa una wallet DEDICADA de premios, nunca la wallet principal:
//   Variable de entorno: PRIZE_WALLET_PRIVATE_KEY (64 hex, con o sin 0x).
// Si falta la llave o no hay saldo, devuelve ok:false y el flujo manual sigue igual.
const { hmac } = require('@noble/hashes/hmac');
const { sha256 } = require('@noble/hashes/sha256');
const { keccak_256 } = require('@noble/hashes/sha3');

function concatBytes(...arrs) {
  const len = arrs.reduce((x, a) => x + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

var _secp = null;
async function ensureSecp() {
  if (_secp) return _secp;
  const s = await import('@noble/secp256k1');
  s.etc.hmacSha256Sync = (key, ...msgs) => hmac(sha256, key, concatBytes(...msgs));
  _secp = { getPublicKey: s.getPublicKey, sign: s.sign };
  return _secp;
}

const CHAIN_ID = 480;
const USDC = '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1'; // 6 decimales
const RPCS = [
  'https://worldchain-mainnet.g.alchemy.com/public',
  'https://worldchain.drpc.org',
];

async function rawRpc(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (j.error) throw new Error('RPC ' + (body.method || 'batch') + ': ' + JSON.stringify(j.error));
  return j.result;
}
async function rpc(method, params = []) {
  let lastErr;
  for (let i = 0; i < RPCS.length; i++) {
    try { return await rawRpc(RPCS[i], { jsonrpc: '2.0', id: 1, method, params }); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function strip(h) { return h.startsWith('0x') ? h.slice(2) : h; }
function padAddr(a) { return strip(a).toLowerCase().padStart(64, '0'); }
function padNum(n) { return BigInt(n).toString(16).padStart(64, '0'); }
function hexBytes(hexNoPrefix) {
  const h = hexNoPrefix.length % 2 ? '0' + hexNoPrefix : hexNoPrefix;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function rlpItem(hexNoPrefix) {
  const b = hexNoPrefix === '' ? '' : (hexNoPrefix.length % 2 ? '0' + hexNoPrefix : hexNoPrefix);
  const bytes = b.length / 2;
  if (bytes === 1 && parseInt(b, 16) < 0x80) return b;
  if (bytes < 56) return (0x80 + bytes).toString(16).padStart(2, '0') + b;
  const lenHex = bytes.toString(16);
  const lenBytes = Math.ceil(lenHex.length / 2);
  const lenPadded = lenHex.padStart(lenBytes * 2, '0');
  return (0xb7 + lenBytes).toString(16) + lenPadded + b;
}
function rlpList(items) {
  const payload = items.join('');
  const bytes = payload.length / 2;
  if (bytes < 56) return (0xc0 + bytes).toString(16).padStart(2, '0') + payload;
  const lenHex = bytes.toString(16);
  const lenBytes = Math.ceil(lenHex.length / 2);
  const lenPadded = lenHex.padStart(lenBytes * 2, '0');
  return (0xf7 + lenBytes).toString(16) + lenPadded + payload;
}
function numHex(n) {
  if (typeof n === 'string') return strip(n);
  const v = BigInt(n);
  if (v === 0n) return '';
  return v.toString(16);
}

async function prizeWalletAddress() {
  const priv = (process.env.PRIZE_WALLET_PRIVATE_KEY || '').replace(/^0x/, '').trim();
  if (priv.length !== 64) throw new Error('PRIZE_WALLET_PRIVATE_KEY no configurada');
  const secp = await ensureSecp();
  const pub = secp.getPublicKey(priv, false);
  const hash = keccak_256(pub.slice(1));
  let addr = '0x';
  for (let i = 12; i < 32; i++) addr += hash[i].toString(16).padStart(2, '0');
  return addr;
}

async function sendTx(to, data) {
  const priv = (process.env.PRIZE_WALLET_PRIVATE_KEY || '').replace(/^0x/, '').trim();
  if (priv.length !== 64) throw new Error('PRIZE_WALLET_PRIVATE_KEY no configurada');
  const from = await prizeWalletAddress();
  const secp = await ensureSecp();
  const nonce = await rpc('eth_getTransactionCount', [from, 'pending']);
  const gasPrice = await rpc('eth_gasPrice', []);
  let gasLimit = '';
  try { gasLimit = await rpc('eth_estimateGas', [{ from, to, data }, 'latest']); }
  catch (e) { gasLimit = '0x' + (100000).toString(16); }
  const unsigned = rlpList([
    rlpItem(numHex(strip(nonce))),
    rlpItem(numHex(strip(gasPrice))),
    rlpItem(numHex(strip(gasLimit))),
    rlpItem(strip(to).toLowerCase()),
    rlpItem(''),
    rlpItem(strip(data)),
    rlpItem(numHex(CHAIN_ID)),
    rlpItem(''),
    rlpItem(''),
  ]);
  const msgHash = keccak_256(hexBytes(unsigned));
  const sig = secp.sign(msgHash, priv);
  const v = 35 + 2 * CHAIN_ID + Number(sig.recovery);
  const signed = rlpList([
    rlpItem(numHex(strip(nonce))),
    rlpItem(numHex(strip(gasPrice))),
    rlpItem(numHex(strip(gasLimit))),
    rlpItem(strip(to).toLowerCase()),
    rlpItem(''),
    rlpItem(strip(data)),
    rlpItem(numHex(v)),
    rlpItem(sig.r.toString(16).padStart(64, '0')),
    rlpItem(sig.s.toString(16).padStart(64, '0')),
  ]);
  return await rpc('eth_sendRawTransaction', ['0x' + signed]);
}

// Paga un premio en USDC a la wallet del ganador. Monto en dolares (ej. 0.05).
async function payPrizeUsdc(toAddr, usdAmount) {
  try {
    const key = (process.env.PRIZE_WALLET_PRIVATE_KEY || '').replace(/^0x/, '').trim();
    if (key.length !== 64) return { ok: false, reason: 'sin_llave' };
    const to = strip(toAddr).toLowerCase();
    if (to.length !== 40) return { ok: false, reason: 'wallet_invalida' };
    const units = BigInt(Math.round(Number(usdAmount) * 1000000)); // USDC: 6 decimales
    if (units <= 0n) return { ok: false, reason: 'monto_invalido' };
    const from = await prizeWalletAddress();
    const balHex = await rpc('eth_call', [{ to: USDC, data: '0x70a08231' + padAddr(from) }, 'latest']);
    const bal = BigInt(balHex || '0x0');
    if (bal < units) return { ok: false, reason: 'sin_saldo_usdc', saldo: bal.toString() };
    const eth = BigInt(await rpc('eth_getBalance', [from, 'latest']));
    if (eth < 100000000000000n) return { ok: false, reason: 'sin_eth_gas' }; // menos de ~0.0001 ETH
    const data = '0xa9059cbb' + padAddr(to) + padNum(units);
    const tx = await sendTx(USDC, data);
    return { ok: true, tx, amount: units.toString() };
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }
}

module.exports = { payPrizeUsdc, prizeWalletAddress };
