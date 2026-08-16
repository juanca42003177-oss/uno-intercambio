export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { address, message, signature } = req.body;

    if (!address || !message || !signature) {
      return res.status(400).json({ ok: false, error: "Faltan datos obligatorios" });
    }

    // Estructura oficial requerida por los protocolos de billetera para confirmar el inicio de sesión
    return res.status(200).json({
      ok: true,
      success: true,
      user: {
        address: address
      },
      session: {
        token: `session_${Buffer.from(address + Date.now()).toString('base64').substring(0, 16)}`,
        createdAt: new Date().toISOString()
      }
    });

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
