import { verifyMessage } from "ethers";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }
  
  try {
    const { address, message, signature } = req.body;
    
    // Usamos directamente verifyMessage de Ethers v6
    const recoveredAddress = verifyMessage(message, signature);
    
    if (recoveredAddress.toLowerCase() === address.toLowerCase()) {
      return res.status(200).json({ ok: true });
    } else {
      return res.status(400).json({ ok: false, error: "Firma inválida" });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
