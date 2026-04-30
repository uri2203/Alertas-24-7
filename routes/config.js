// ═══════════════════════════════════════════════════════════════
//  routes/config.js
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express';
import crypto     from 'crypto';

export function configRouter(appConfig) {
  const router = Router();

  // Password hash + app version (never sends plain password)
  router.get('/', (req, res) => {
    const hash = crypto
      .createHash('sha256')
      .update(appConfig.password)
      .digest('hex');
    res.json({
      passwordHash: hash,
      version:      '5.0',
      symbols:      appConfig.symbols,
      tfs:          appConfig.tfs,
    });
  });

  return router;
}
