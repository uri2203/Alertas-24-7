// ═══════════════════════════════════════════════════════════════
//  routes/tracker.js
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express';
import { getStats } from '../engine/tracker.js';

export function trackerRouter() {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const stats = await getStats();
      res.json({ ok: true, ...stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
