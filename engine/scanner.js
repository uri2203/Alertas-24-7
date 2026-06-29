// ═══════════════════════════════════════════════════════════════
//  engine/scanner.js  —  Trading Dashboard PRO v7
//  Motor de Escaneo Autónomo 24/7
// ═══════════════════════════════════════════════════════════════
import { scoreSignal, TF_CONFIG, TF_PARENT } from './signals.js';
import { sendTelegram, buildAlertMessage }    from './telegram.js';
import { trackSignal, evaluatePending }       from './tracker.js';

export const STATE = {
  signals:      {},
  prices:       {},
  lastScan:     null,
  daemonActive: false,
  isScanning:   false,
  paused:       false,
  scanCount:    0,
  errors:       [],
  session:      null,
};

const alertCooldown  = {};
const lastDirSent    = {};
const mayorCache     = {};
const MAYOR_CACHE_MS = 3 * 60 * 1000;
const ANTI_CONTRA_MS = 15 * 60 * 1000;

// ── SESIÓN ACTIVA ────────────────────────────────────────────────
function getSession() {
  const mxStr  = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
  const mxDate = new Date(mxStr);
  const h      = mxDate.getHours() + mxDate.getMinutes() / 60;

  if (h >= 8  && h < 12) return { name: 'Mañana', minScore: 6, minScoreDiv: 5, cooldownMs: 15 * 60 * 1000 };
  if (h >= 12 && h < 14) return { name: 'Mediodía', minScore: 7, minScoreDiv: 5, cooldownMs: 20 * 60 * 1000 };
  if (h >= 14 && h < 18) return { name: 'Tarde',  minScore: 6, minScoreDiv: 5, cooldownMs: 15 * 60 * 1000 };
  if (h >= 18 && h < 20) return { name: 'atardecer', minScore: 7, minScoreDiv: 5, cooldownMs: 20 * 60 * 1000 };
  if (h >= 20 && h < 24) return { name: 'Noche',  minScore: 7, minScoreDiv: 5, cooldownMs: 20 * 60 * 1000 };
  if (h >= 0  && h < 8)  return { name: 'Madrugada', minScore: 7, minScoreDiv: 6, cooldownMs: 20 * 60 * 1000 };
  return null;
}

// ── FILTRO ANTI-CONTRADICCIÓN ────────────────────────────────────
function isContradicted(sym, dir) {
  const last = lastDirSent[sym];
  if (!last) return false;
  return last.dir !== dir && Date.now() - last.time < ANTI_CONTRA_MS;
}

function registerSent(sym, dir) {
  lastDirSent[sym] = { dir, time: Date.now() };
}

// ── FETCH CANDLES ────────────────────────────────────────────────
export async function fetchCandles(symbol, interval, limit = 500) {
  const endpoints = [
    'https://data-api.binance.vision/api/v3/klines',
    'https://api1.binance.com/api/v3/klines',
    'https://api2.binance.com/api/v3/klines',
    'https://api3.binance.com/api/v3/klines',
  ];
  let lastError;
  for (const base of endpoints) {
    try {
      const url = `${base}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Server Daemon)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.map(k => ({
        time: +k[0] / 1000,
        open: +k[1], high: +k[2], low: +k[3], close: +k[4], vol: +k[5],
      }));
    } catch (e) { lastError = e; }
  }
  throw lastError;
}

// ── CANDLES TF MAYOR con caché ────────────────────────────────────
async function getMayorCandles(symbol, tf) {
  const parentTf = TF_PARENT[tf];
  if (!parentTf) return null;
  const cacheKey = `${symbol}-${parentTf}`;
  const cached   = mayorCache[cacheKey];
  if (cached && Date.now() - cached.ts < MAYOR_CACHE_MS) return cached.candles;
  try {
    const candles = await fetchCandles(symbol, parentTf, 200);
    mayorCache[cacheKey] = { candles, ts: Date.now() };
    return candles;
  } catch (e) {
    console.error(`   [ERR] TF Mayor ${symbol}/${parentTf}: ${e.message}`);
    return null;
  }
}

// ── CICLO DE ESCANEO ─────────────────────────────────────────────
async function runCycle(config) {
  if (STATE.isScanning) return;

  if (STATE.paused) {
    STATE.session = 'Pausado';
    console.log(`[SCANNER] ⏸ Pausado manualmente — sin envíos.`);
    return;
  }

  const session = getSession();
  STATE.session = session ? session.name : 'Fuera de horario';
  if (!session) {
    console.log(`[SCANNER] Fuera de horario — pausado hasta próxima sesión.`);
    // Aun fuera de horario evaluamos resultados pendientes
    await evaluatePending(fetchCandles).catch(() => {});
    return;
  }

  STATE.isScanning = true;
  STATE.scanCount++;
  STATE.lastScan = new Date().toISOString();

  console.log(`\n[SCAN #${STATE.scanCount}] Sesión: ${session.name} | Score≥${session.minScore}/8 | Cooldown: ${session.cooldownMs / 60000}min`);

  const activeThisCycle = new Set();

  for (const sym of config.symbols) {
    for (const tf of config.tfs) {
      const key = `${sym}-${tf}`;
      try {
        const candles      = await fetchCandles(sym, tf);
        const mayorCandles = await getMayorCandles(sym, tf);

        if (candles && candles.length)
          STATE.prices[sym] = candles[candles.length - 1].close;

        const sig = scoreSignal(candles, tf, TF_CONFIG, mayorCandles);
        if (!sig || sig.signal === 'WAIT') continue;

        const divAligned = sig.divergence &&
          ((sig.dir === 'up' && sig.divergence === 'bullish') ||
           (sig.dir === 'dn' && sig.divergence === 'bearish'));

        const passNormal = sig.score >= session.minScore;
        const passDiv    = divAligned && sig.score >= session.minScoreDiv;

        if (!passNormal && !passDiv) continue;

        // Filtro anti-contradicción
        if (isContradicted(sym, sig.dir)) {
          const last    = lastDirSent[sym];
          const restMin = Math.ceil((ANTI_CONTRA_MS - (Date.now() - last.time)) / 60000);
          console.log(`   🚫 [ANTI-CONTRA] ${sym} ${tf} — ${sig.signal} bloqueado (espera ${restMin} min más)`);
          continue;
        }

        activeThisCycle.add(key);
        const isDivergence = passDiv && !passNormal;
        STATE.signals[key] = { sym, tf, ...sig, isDivergence };

        const now = Date.now();
        if (!alertCooldown[key] || now - alertCooldown[key] > session.cooldownMs) {
          alertCooldown[key] = now;
          registerSent(sym, sig.dir);

          const text = buildAlertMessage(sym, tf, sig, isDivergence);
          if (config.telegram.token && config.telegram.chatId) {
            const result = await sendTelegram(config.telegram.token, config.telegram.chatId, text);
            const tag    = isDivergence ? '📐 DIV' : '✅';
            if (result.ok) {
              console.log(`   ${tag} [ALERTA] ${sig.signal} ${sym} ${tf} (Score: ${sig.score}/8)`);
              // Registrar en tracker para evaluar después
              await trackSignal(sym, tf, sig, isDivergence).catch(() => {});
            } else {
              console.log(`   ❌ [ERR TELEGRAM] ${JSON.stringify(result)}`);
            }
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

  // Evaluar resultados pendientes de señales anteriores
  await evaluatePending(fetchCandles).catch(() => {});

  STATE.isScanning = false;
  console.log(`[SCAN #${STATE.scanCount}] Completado. Señales activas: ${Object.keys(STATE.signals).length}`);
}

// ── INICIO ───────────────────────────────────────────────────────
export function startScanner(config) {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Motor Autónomo 24/7 INICIADO  v7        ║');
  console.log('║  MACD + ADX + Div RSI + Anti-Contra      ║');
  console.log('║  Tracker de resultados ACTIVO            ║');
  console.log('║  Horario México activado                 ║');
  console.log('╚══════════════════════════════════════════╝');
  STATE.daemonActive = true;
  runCycle(config);
  setInterval(() => runCycle(config), 3 * 60 * 1000);
}
