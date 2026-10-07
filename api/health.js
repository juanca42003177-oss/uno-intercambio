// health — endpoint de prueba para que el cliente detecte si corre en Vercel
module.exports = (req, res) => {
  res.status(200).json({ ok: true, runtime: 'vercel', ts: Date.now() });
};
