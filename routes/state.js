// ═══════════════════════════════════════════════════════════════
//  routes/state.js
//  Devuelve estado básico. El frontend no depende de esto para funcionar.
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express';
import { STATE }  from '../engine/scanner.js';

export function stateRouter() {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({
      mode:          'frontend-first',
      engineRunning: false,
      message:       'El análisis se ejecuta en el navegador del usuario',
      lastScan:      STATE.lastScan,
      scanCount:     STATE.scanCount,
      signals:       {},
      prices:        {},
      errors:        [],
    });
  });

  return router;
}
