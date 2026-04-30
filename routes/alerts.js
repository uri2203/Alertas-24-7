// ═══════════════════════════════════════════════════════════════
//  routes/alerts.js
//  Proxy: browser → this endpoint → Telegram API
//  Token never travels to the browser.
// ═══════════════════════════════════════════════════════════════
import { Router }       from 'express';
import { sendTelegram } from '../engine/telegram.js';

export function alertsRouter(appConfig) {
  const router = Router();

  // Test or manual message from browser
  router.post('/', async (req, res) => {
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
