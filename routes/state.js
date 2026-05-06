// ═══════════════════════════════════════════════════════════════
//  routes/state.js
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express';
import { STATE }  from '../engine/scanner.js';

export function stateRouter() {
  const router = Router();

  // GET /api/state — estado actual del scanner
  router.get('/', (req, res) => {
    res.json({
      mode:         'server-autonomous',
      daemonActive: STATE.daemonActive,
      isScanning:   STATE.isScanning,
      paused:       STATE.paused,
      session:      STATE.session,
      message:      'Escáner backend activo 24/7 transmitiendo a Telegram.',
      lastScan:     STATE.lastScan,
      scanCount:    STATE.scanCount,
      signals:      STATE.signals,
      prices:       STATE.prices,
      errors:       STATE.errors,
    });
  });

  // POST /api/state/pause — pausa o activa el scanner
  router.post('/pause', (req, res) => {
    const { paused } = req.body;
    if (typeof paused !== 'boolean')
      return res.status(400).json({ ok: false, error: 'Se requiere { paused: true/false }' });

    STATE.paused = paused;
    console.log(`[SCANNER] ${paused ? '⏸ PAUSADO por el usuario' : '▶ ACTIVADO por el usuario'}`);
    res.json({ ok: true, paused: STATE.paused });
  });

  return router;
}
