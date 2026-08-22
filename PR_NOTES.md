# PR: router-integration notes

Esta rama contiene la integración básica del frontend para interactuar con CommissionRouter:
- approveToken(token, amount)
- collectTokenViaRouter(token, amount, recipient)
- collectNativeViaRouter(amountWei, recipient)

Recuerda rellenar ROUTER_ADDRESS en index.html o en frontend/config.js tras desplegar el contrato en Mumbai/mainnet.
