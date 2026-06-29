// ═══════════════════════════════════════════════════════════════
//  routes/alerts.js
//  Credentials ALWAYS from server env vars, never from client.
// ═══════════════════════════════════════════════════════════════
import { Router }       from 'express';
import { sendTelegram } from '../engine/telegram.js';

export function alertsRouter(appConfig) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { text } = req.body;

    const token  = appConfig.telegram.token;
    const chatId = appConfig.telegram.chatId;

    if (!token || !chatId)
      return res.status(500).json({ ok: false, error: 'Telegram no configurado en el servidor' });

    if (!text || typeof text !== 'string' || !text.trim())
      return res.status(400).json({ ok: false, error: 'Mensaje vacío' });

    if (text.length > 4096)
      return res.status(400).json({ ok: false, error: 'Mensaje demasiado largo (máx 4096 chars)' });

    const result = await sendTelegram(token, chatId, text);

    if (result.ok) {
      res.json({ ok: true });
    } else {
      console.error('[TELEGRAM] Error:', result.error);
      res.json({ ok: false, error: 'Error al enviar mensaje' });
    }
  });

  return router;
}
