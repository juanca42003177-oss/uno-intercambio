export default function Home() {
  return (
    <main style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1 style={{ fontSize: '2.5rem', fontWeight: '900', marginBottom: '10px' }}>
          Uno Intercambio
        </h1>
        <p style={{ fontSize: '1.1rem', color: '#666', marginBottom: '20px' }}>
          Plataforma segura de intercambio de criptomonedas integrada con Worldcoin
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '20px',
        marginBottom: '40px'
      }}>
        <div style={{
          padding: '30px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '15px',
          color: 'white',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>💱</div>
          <h3 style={{ marginBottom: '10px' }}>Intercambiar</h3>
          <p>Swap entre World Chain, Polygon y zkEVM</p>
        </div>

        <div style={{
          padding: '30px',
          background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
          borderRadius: '15px',
          color: 'white',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>💰</div>
          <h3 style={{ marginBottom: '10px' }}>Ganar</h3>
          <p>Rendimiento de hasta 4.19% APY</p>
        </div>

        <div style={{
          padding: '30px',
          background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
          borderRadius: '15px',
          color: 'white',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🔐</div>
          <h3 style={{ marginBottom: '10px' }}>Seguro</h3>
          <p>Validación backend y autenticación Worldcoin</p>
        </div>
      </div>

      <div style={{
        background: '#f0f0f0',
        padding: '30px',
        borderRadius: '15px',
        marginBottom: '30px'
      }}>
        <h2>Características Principales</h2>
        <ul style={{ marginTop: '15px', lineHeight: '1.8' }}>
          <li>✅ Intercambio seguro entre múltiples redes blockchain</li>
          <li>✅ Comisiones transparentes (0.5% + gas)</li>
          <li>✅ Autenticación con Worldcoin ID</li>
          <li>✅ Rate limiting y protección DDoS</li>
          <li>✅ Validación backend de transacciones</li>
          <li>✅ Soporte World Chain, Polygon y zkEVM</li>
        </ul>
      </div>

      <div style={{ textAlign: 'center', color: '#666' }}>
        <p>Versión 1.0.0 | MIT License</p>
        <p style={{ marginTop: '10px', fontSize: '0.9rem' }}>
          En revisión por Worldcoin para aprobación oficial
        </p>
      </div>
    </main>
  );
}
