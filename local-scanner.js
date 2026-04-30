// ═══════════════════════════════════════════════════════════════
//  local-scanner.js
//  Corre en tu PC con:  node local-scanner.js
//  Usa TU IP local (no está bloqueada por Binance).
//  Envía alertas a Telegram cuando hay señales.
// ═══════════════════════════════════════════════════════════════
import { scoreSignal, TF_CONFIG } from './engine/signals.js';
import { sendTelegram, buildAlertMessage } from './engine/telegram.js';

const CONFIG = {
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'],
  tfs: ['5m', '1h', '4h'],
  telegram: {
    token:  process.env.TELEGRAM_BOT_TOKEN  || '',
    chatId: process.env.TELEGRAM_CHAT_ID    || '',
  },
  signalCooldownMs: 5 * 60 * 1000,
  scanIntervalMs:   60 * 1000,
};

const lastAlertSent = {};

// ── FETCH (desde tu PC, no desde cloud) ───────────────────────
async function fetchCandles(symbol, interval, limit = 250) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.map(k => ({
    time: +k[0] / 1000,
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], vol: +k[5],
  }));
}

// ── SCAN CYCLE ──────────────────────────────────────────────────
async function runCycle() {
  for (const sym of CONFIG.symbols) {
    for (const tf of CONFIG.tfs) {
      try {
        const candles = await fetchCandles(sym, tf);
        const sig = scoreSignal(candles, tf, TF_CONFIG);
        if (!sig || sig.signal === 'WAIT') continue;

        const key = `${sym}-${tf}`;
        const last = lastAlertSent[key] || 0;

        if (Date.now() - last > CONFIG.signalCooldownMs) {
          lastAlertSent[key] = Date.now();

          if (CONFIG.telegram.token && CONFIG.telegram.chatId) {
            const text = buildAlertMessage(sym, tf, sig);
            const result = await sendTelegram(CONFIG.telegram.token, CONFIG.telegram.chatId, text);
            console.log(result.ok
              ? `✅ ALERTA ENVIADA: ${sig.signal} ${sym} ${tf}`
              : `❌ Error Telegram: ${result.error}`
            );
          } else {
            console.log(`🔔 SEÑAL: ${sig.signal} ${sym} ${tf} (sin Telegram configurado)`);
          }
        }
      } catch (e) {
        console.error(`[ERROR] ${sym}/${tf}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
  console.log(`[SCAN] ${new Date().toLocaleTimeString('es-MX')} completado`);
}

// ── START ─────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════╗');
console.log('║  Local Scanner PRO v5                    ║');
console.log('║  Corre en tu PC — alertas 24/7          ║');
console.log('╚══════════════════════════════════════════╝');

if (!CONFIG.telegram.token || !CONFIG.telegram.chatId) {
  console.log('⚠️  Configura TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID para alertas');
}

runCycle();
setInterval(runCycle, CONFIG.scanIntervalMs);
