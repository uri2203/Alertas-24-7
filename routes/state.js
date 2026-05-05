// ═══════════════════════════════════════════════════════════════
//  routes/state.js
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express';
import { STATE }  from '../engine/scanner.js';

export function stateRouter() {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({
      mode:          'server-autonomous',
      engineRunning: STATE.engineRunning,
      message:       'Escáner backend activo 24/7 transmitiendo a Telegram.',
      lastScan:      STATE.lastScan,
      scanCount:     STATE.scanCount,
      signals:       STATE.signals,
      prices:        STATE.prices,
      errors:        STATE.errors,
    });
  });

  return router;
}
