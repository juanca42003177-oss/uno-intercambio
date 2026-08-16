import { App } from 'https://esm.sh';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { address, message, signature } = req.body;

    if (!address || !message || !signature) {
      return res.status(400).json({ ok: false, error: "Faltan datos obligatorios" });
    }

    // Respuesta exitosa temporal para limpiar el flujo de la World App
    return res.status(200).json({ ok: true, wallet: address });

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
