// ═══════════════════════════════════════════════════════════════
//  local-scanner.js  v6
//  Corre en tu PC con:  node local-scanner.js
//  Envía alertas a Telegram DIRECTAMENTE (sin servidor).
//  Sistema siempre activo mientras esté corriendo.
// ═══════════════════════════════════════════════════════════════
import { scoreSignal, TF_CONFIG } from './engine/signals.js';
import { sendTelegram, buildAlertMessage } from './engine/telegram.js';
import * as dotenv from 'dotenv';
dotenv.config();

const CONFIG = {
  symbols: [
    'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
    'ADAUSDT','DOGEUSDT','LINKUSDT','AVAXUSDT','DOTUSDT',
    'MATICUSDT','LTCUSDT','UNIUSDT','NEARUSDT'
  ],
  tfs: ['5m','1h','4h'],
  telegram: {
    token:  process.env.TELEGRAM_BOT_TOKEN  || '',
    chatId: process.env.TELEGRAM_CHAT_ID    || '',
  },
  signalCooldownMs: 10 * 60 * 1000,  // 10 min entre alertas por par/tf
  scanIntervalMs:    2 * 60 * 1000,  // escaneo cada 2 min
  minScore: 3,                        // mínimo score para alertar
};

const lastAlertSent = {};
let scanCount = 0;
let totalSignals = 0;

// ── FETCH ────────────────────────────────────────────────────────
async function fetchCandles(symbol, interval, limit = 500) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${symbol} ${interval}`);
  const data = await res.json();
  return data.map(k => ({
    time: +k[0] / 1000,
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], vol: +k[5],
  }));
}

// ── SCAN CYCLE ───────────────────────────────────────────────────
async function runCycle() {
  scanCount++;
  const ts = new Date().toLocaleTimeString('es-MX');
  console.log(`\n[SCAN #${scanCount}] ${ts} — Iniciando...`);

  let cycleSignals = 0;
  for (const sym of CONFIG.symbols) {
    for (const tf of CONFIG.tfs) {
      try {
        const candles = await fetchCandles(sym, tf);
        const sig = await scoreSignal(candles, tf, TF_CONFIG);
        if (!sig || sig.signal === 'WAIT') continue;
        if (sig.score < CONFIG.minScore) continue;

        cycleSignals++;
        totalSignals++;
        const key = `${sym}-${tf}`;
        const last = lastAlertSent[key] || 0;

        if (Date.now() - last > CONFIG.signalCooldownMs) {
          lastAlertSent[key] = Date.now();

          const emoji = sig.signal === 'LONG' ? '🟢' : '🔴';
          console.log(`${emoji} ${sig.signal} ${sym} ${tf} — ${sig.score}/${sig.max} · Entrada: ${sig.price}`);

          if (CONFIG.telegram.token && CONFIG.telegram.chatId) {
            const text = buildAlertMessage(sym, tf, sig);
            const result = await sendTelegram(CONFIG.telegram.token, CONFIG.telegram.chatId, text);
            if (result.ok) {
              console.log(`   ✅ Telegram enviado`);
            } else {
              console.log(`   ❌ Error Telegram: ${JSON.stringify(result)}`);
            }
          }
        } else {
          const restMs = CONFIG.signalCooldownMs - (Date.now() - last);
          console.log(`   ⏳ ${sym} ${tf} cooldown — ${Math.ceil(restMs/60000)} min restantes`);
        }

      } catch (e) {
        console.error(`   [ERR] ${sym}/${tf}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 400)); // pausa entre llamadas
    }
  }

  console.log(`[SCAN #${scanCount}] Completo — ${cycleSignals} señales activas · Total histórico: ${totalSignals}`);
}

// ── STATUS HEARTBEAT ─────────────────────────────────────────────
async function sendHeartbeat() {
  if (!CONFIG.telegram.token || !CONFIG.telegram.chatId) return;
  const text = `💓 <b>Scanner PRO v6 — Online</b>
🕐 ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}
📊 ${CONFIG.symbols.length} pares × ${CONFIG.tfs.length} TFs
⏱ Ciclo: cada ${CONFIG.scanIntervalMs/60000} minutos
🔔 Alerta con score ≥ ${CONFIG.minScore}/4`;
  await sendTelegram(CONFIG.telegram.token, CONFIG.telegram.chatId, text);
}

// ── START ────────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════╗');
console.log('║  Trading Dashboard PRO — Scanner v6          ║');
console.log('║  Sistema ONLINE · Alertas directas Telegram  ║');
console.log(`║  Pares: ${CONFIG.symbols.length} · TFs: ${CONFIG.tfs.join(', ')}              ║`);
console.log('╚══════════════════════════════════════════════╝\n');

if (!CONFIG.telegram.token || !CONFIG.telegram.chatId) {
  console.log('⚠️  CONFIGURA EN .env:');
  console.log('   TELEGRAM_BOT_TOKEN=tu_token');
  console.log('   TELEGRAM_CHAT_ID=tu_chat_id\n');
} else {
  console.log('✅ Telegram configurado — enviando heartbeat...');
  sendHeartbeat();
}

runCycle();
setInterval(runCycle, CONFIG.scanIntervalMs);

// Heartbeat cada 6 horas para saber que sigue vivo
setInterval(sendHeartbeat, 6 * 60 * 60 * 1000);
