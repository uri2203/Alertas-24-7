// ═══════════════════════════════════════════════════════════════
//  engine/scanner.js  —  DESACTIVADO EN SERVIDOR
//  Binance bloquea IPs de cloud (HTTP 451).
//  El frontend hace todo el trabajo directamente desde el navegador.
//  Para usar este scanner, correlo en tu PC local con:
//    node local-scanner.js
// ═══════════════════════════════════════════════════════════════

export const STATE = {
  signals:       {},
  prices:        {},
  lastScan:      null,
  engineRunning: false,
  scanCount:     0,
  errors:        [],
};

// Scanner desactivado en servidor — usar local-scanner.js en tu PC
export function startScanner(config) {
  console.log('⚠️  Scanner desactivado: Binance bloquea IPs de cloud hosting');
  console.log('💡 Usa local-scanner.js en tu PC para alertas 24/7');
  STATE.engineRunning = false;
}
