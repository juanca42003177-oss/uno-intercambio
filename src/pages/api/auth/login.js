export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { worldcoinVerificationToken } = req.body;

    if (!worldcoinVerificationToken) {
      return res.status(400).json({ error: 'Token de Worldcoin requerido' });
    }

    // En producción: verificar con API de Worldcoin
    // const verified = await verifyWorldcoinToken(worldcoinVerificationToken);
    // if (!verified) return res.status(401).json({ error: 'Token inválido' });

    const token = 'jwt_' + Math.random().toString(36).substring(2, 15);
    
    return res.status(200).json({
      success: true,
      token,
      user: {
        id: 'user_' + Date.now(),
        verified: true
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({ error: 'Error en autenticación' });
  }
}
