// ═══════════════════════════════════════════════════════════════
//  engine/scanner.js
//  Motor de Escaneo Autónomo (Servidor 24/7)
//  Horario México (America/Mexico_City):
//    8am–12pm  → score ≥ 3, cooldown 15 min
//    2pm–6pm   → score ≥ 3, cooldown 15 min
//    8pm–12am  → score = 4, cooldown 20 min (solo las mejores)
//    12am–8am  → PAUSADO automático
//    12pm–2pm  → PAUSADO automático
//  STATE.paused = true → pausado manualmente desde el dashboard
// ═══════════════════════════════════════════════════════════════
import { scoreSignal, TF_CONFIG } from './signals.js';
import { sendTelegram, buildAlertMessage } from './telegram.js';

export const STATE = {
  signals:      {},
  prices:       {},
  lastScan:     null,
  daemonActive: false,
  isScanning:   false,
  paused:       false, // pausa manual desde el dashboard
  scanCount:    0,
  errors:       [],
  session:      null,
};

const alertCooldown = {};

// ── SESIÓN ACTIVA según hora México ──────────────────────────────
function getSession() {
  const mxStr  = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
  const mxDate = new Date(mxStr);
  const h      = mxDate.getHours() + mxDate.getMinutes() / 60;

  if (h >= 8  && h < 12) return { name: 'Mañana', minScore: 3, cooldownMs: 15 * 60 * 1000 };
  if (h >= 14 && h < 18) return { name: 'Tarde',  minScore: 3, cooldownMs: 15 * 60 * 1000 };
  if (h >= 20 && h < 24) return { name: 'Noche',  minScore: 4, cooldownMs: 20 * 60 * 1000 };
  return null;
}

// ── FETCH CANDLES ────────────────────────────────────────────────
async function fetchCandles(symbol, interval, limit = 500) {
  const endpoints = [
    'https://data-api.binance.vision/api/v3/klines',
    'https://api1.binance.com/api/v3/klines',
    'https://api2.binance.com/api/v3/klines',
    'https://api3.binance.com/api/v3/klines'
  ];

  let lastError;
  for (const base of endpoints) {
    try {
      const url = `${base}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Server Daemon)' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.map(k => ({
        time: +k[0] / 1000,
        open: +k[1], high: +k[2], low: +k[3], close: +k[4], vol: +k[5],
      }));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// ── CICLO DE ESCANEO ─────────────────────────────────────────────
async function runCycle(config) {
  if (STATE.isScanning) return;

  // Pausa manual desde el dashboard
  if (STATE.paused) {
    STATE.session = 'Pausado';
    console.log(`[SCANNER] ⏸ Pausado manualmente — sin envíos.`);
    return;
  }

  // Pausa automática por horario
  const session = getSession();
  STATE.session = session ? session.name : 'Fuera de horario';

  if (!session) {
    console.log(`[SCANNER] Fuera de horario — pausado hasta próxima sesión.`);
    return;
  }

  STATE.isScanning = true;
  STATE.scanCount++;
  STATE.lastScan = new Date().toISOString();

  console.log(`\n[SCAN #${STATE.scanCount}] Sesión: ${session.name} | Score≥${session.minScore} | Cooldown: ${session.cooldownMs / 60000}min`);

  const activeThisCycle = new Set();

  for (const sym of config.symbols) {
    for (const tf of config.tfs) {
      const key = `${sym}-${tf}`;
      try {
        const candles = await fetchCandles(sym, tf);
        const sig     = scoreSignal(candles, tf, TF_CONFIG);

        if (candles && candles.length)
          STATE.prices[sym] = candles[candles.length - 1].close;

        if (!sig || sig.signal === 'WAIT' || sig.score < session.minScore) continue;

        activeThisCycle.add(key);
        STATE.signals[key] = { sym, tf, ...sig };

        const now = Date.now();
        if (!alertCooldown[key] || now - alertCooldown[key] > session.cooldownMs) {
          alertCooldown[key] = now;
          const text = buildAlertMessage(sym, tf, sig);
          if (config.telegram.token && config.telegram.chatId) {
            const result = await sendTelegram(config.telegram.token, config.telegram.chatId, text);
            if (result.ok)
              console.log(`   ✅ [ALERTA ENVIADA] ${sig.signal} ${sym} ${tf} (Score: ${sig.score}/4)`);
            else
              console.log(`   ❌ [ERR TELEGRAM] ${JSON.stringify(result)}`);
          }
        }

      } catch (e) {
        console.error(`   [ERR] Scanner ${sym}/${tf}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 600));
    }
  }

  // Limpiar señales vencidas
  const before = Object.keys(STATE.signals).length;
  for (const key of Object.keys(STATE.signals))
    if (!activeThisCycle.has(key)) delete STATE.signals[key];
  const removed = before - Object.keys(STATE.signals).length;
  if (removed > 0) console.log(`   🧹 ${removed} señal(es) vencida(s) eliminada(s).`);

  STATE.isScanning = false;
  console.log(`[SCAN #${STATE.scanCount}] Completado. Señales activas: ${Object.keys(STATE.signals).length}`);
}

// ── INICIO ───────────────────────────────────────────────────────
export function startScanner(config) {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Motor Autónomo 24/7 INICIADO            ║');
  console.log('║  Horario México activado                 ║');
  console.log('╚══════════════════════════════════════════╝');

  STATE.daemonActive = true;

  runCycle(config);
  setInterval(() => runCycle(config), 3 * 60 * 1000);
}
