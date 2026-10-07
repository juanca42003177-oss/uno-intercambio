// health — endpoint de prueba para que el cliente detecte si corre en Vercel
const wrap = require('./_cors');
module.exports = wrap((req, res) => {
  res.status(200).json({ ok: true, runtime: 'vercel', ts: Date.now() });
});
