// ═══════════════════════════════════════════════════════════════
//  routes/alerts.js
//  Proxy: browser → this endpoint → Telegram API
//  Asegurado mediante Static Bearer API Key (Hash SHA-256).
// ═══════════════════════════════════════════════════════════════
import { Router }       from 'express';
import crypto           from 'crypto';
import { sendTelegram } from '../engine/telegram.js';

export function alertsRouter(appConfig) {
  const router = Router();

  // Test or manual message from browser
  router.post('/', async (req, res) => {
    // ── 1. VALIDACIÓN DE SEGURIDAD (ZERO TRUST) ──────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn('[SECURITY] Intento de acceso no autorizado a /api/telegram');
      return res.status(401).json({ ok: false, error: 'No autorizado. Se requiere API Key.' });
    }

    const providedHash = authHeader.split(' ')[1];
    const expectedHash = crypto.createHash('sha256').update(appConfig.password).digest('hex');

    if (providedHash !== expectedHash) {
      console.warn('[SECURITY] Payload rechazado: API Key inválida.');
      return res.status(403).json({ ok: false, error: 'API Key inválida.' });
    }

    // ── 2. PROCESAMIENTO DEL PAYLOAD ─────────────────────────────
    const { token, chatId, text } = req.body;

    // Use env vars if browser didn't send credentials
    const t = token  || appConfig.telegram.token;
    const c = chatId || appConfig.telegram.chatId;

    if (!t || !c)
      return res.status(400).json({ ok: false, error: 'Token o Chat ID no configurados' });

    if (!text || !text.trim())
      return res.status(400).json({ ok: false, error: 'Mensaje vacío' });

    const result = await sendTelegram(t, c, text);
    res.json(result);
  });

  return router;
}
