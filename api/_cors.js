// _cors.js — envuelve los handlers con CORS abierto. Asi las apps pueden
// llamar esta API desde cualquier origen (Vercel, GitHub Pages, World App)
// SIN pasar nunca por Base44.
module.exports = function wrap(handler) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    return handler(req, res);
  };
};
