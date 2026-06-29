// ═══════════════════════════════════════════════════════════════
//  routes/config.js — Public config, no secrets
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express';

export function configRouter(appConfig) {
  const router = Router();
  router.get('/', (req, res) => {
    res.json({ version: '7.0', symbols: appConfig.symbols, tfs: appConfig.tfs });
  });
  return router;
}
