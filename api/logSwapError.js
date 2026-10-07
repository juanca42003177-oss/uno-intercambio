// logSwapError — deja el detalle real de un swap fallido en los logs de Vercel.
// Fire-and-forget: el cliente nunca espera esta respuesta.
module.exports = async (req, res) => {
  const body = req.body || {};
  console.error('SWAP_FAILED', JSON.stringify({
    from: body.from, to: body.to, amt: body.amt,
    quoteType: body.quoteType, legs: body.legs,
    rawError: body.rawError, ts: Date.now(),
  }));
  return res.status(200).json({ ok: true });
};
