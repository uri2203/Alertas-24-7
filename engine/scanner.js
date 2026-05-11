// ═══════════════════════════════════════════════════════════════
//  engine/scanner.js  —  Trading Dashboard PRO v7
//  Motor de Escaneo Autónomo 24/7
//
//  Horario México (America/Mexico_City):
//    8am–12pm  → score ≥ 6/8, cooldown 15 min
//    2pm–6pm   → score ≥ 6/8, cooldown 15 min
//    8pm–12am  → score ≥ 7/8, cooldown 20 min
//    resto     → PAUSADO automático
//
//  Filtro anti-contradicción:
//    Si en los últimos 15 min se envió LONG de BTC (cualquier TF),
//    se bloquea cualquier SHORT de BTC hasta que pase ese tiempo.
// ═══════════════════════════════════════════════════════════════
import { scoreSignal, TF_CONFIG, TF_PARENT } from './signals.js';
import { sendTelegram, buildAlertMessage }    from './telegram.js';

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

const alertCooldown  = {};   // cooldown por par+TF
const lastDirSent    = {};   // { 'BTCUSDT': { dir: 'up', time: Date.now() } }
const mayorCache     = {};
const MAYOR_CACHE_MS = 3 * 60 * 1000;
const ANTI_CONTRA_MS = 15 * 60 * 1000; // ventana anti-contradicción

// ── SESIÓN ACTIVA ────────────────────────────────────────────────
function getSession() {
  const mxStr  = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
  const mxDate = new Date(mxStr);
  const h      = mxDate.getHours() + mxDate.getMinutes() / 60;

  if (h >= 8  && h < 12) return { name: 'Mañana', minScore: 6, minScoreDiv: 5, cooldownMs: 15 * 60 * 1000 };
  if (h >= 14 && h < 18) return { name: 'Tarde',  minScore: 6, minScoreDiv: 5, cooldownMs: 15 * 60 * 1000 };
  if (h >= 20 && h < 24) return { name: 'Noche',  minScore: 7, minScoreDiv: 5, cooldownMs: 20 * 60 * 1000 };
  return null;
}

// ── FILTRO ANTI-CONTRADICCIÓN ────────────────────────────────────
// Retorna true si la señal está bloqueada por una señal contraria reciente
function isContradicted(sym, dir) {
  const last = lastDirSent[sym];
  if (!last) return false;
  const isOpposite = last.dir !== dir;
  const isRecent   = Date.now() - last.time < ANTI_CONTRA_MS;
  return isOpposite && isRecent;
}

// Registra la dirección enviada para un símbolo
function registerSent(sym, dir) {
  lastDirSent[sym] = { dir, time: Date.now() };
}

// ── FETCH CANDLES ────────────────────────────────────────────────
async function fetchCandles(symbol, interval, limit = 500) {
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

        // ── Verificar si pasa los filtros de score ───────────────
        const divAligned = sig.divergence &&
          ((sig.dir === 'up' && sig.divergence === 'bullish') ||
           (sig.dir === 'dn' && sig.divergence === 'bearish'));

        const passNormal = sig.score >= session.minScore;
        const passDiv    = divAligned && sig.score >= session.minScoreDiv;

        if (!passNormal && !passDiv) continue;

        // ── FILTRO ANTI-CONTRADICCIÓN ────────────────────────────
        if (isContradicted(sym, sig.dir)) {
          const last     = lastDirSent[sym];
          const restMin  = Math.ceil((ANTI_CONTRA_MS - (Date.now() - last.time)) / 60000);
          const dirLabel = sig.signal === 'LONG' ? 'LONG' : 'SHORT';
          console.log(`   🚫 [ANTI-CONTRA] ${sym} ${tf} — ${dirLabel} bloqueado (señal contraria hace ${15 - restMin} min, espera ${restMin} min más)`);
          continue;
        }

        activeThisCycle.add(key);
        STATE.signals[key] = { sym, tf, ...sig, isDivergence: passDiv && !passNormal };

        const now = Date.now();
        if (!alertCooldown[key] || now - alertCooldown[key] > session.cooldownMs) {
          alertCooldown[key] = now;

          // Registrar dirección enviada para este símbolo (anti-contradicción)
          registerSent(sym, sig.dir);

          const text = buildAlertMessage(sym, tf, sig, passDiv && !passNormal);
          if (config.telegram.token && config.telegram.chatId) {
            const result = await sendTelegram(config.telegram.token, config.telegram.chatId, text);
            const tag    = passDiv && !passNormal ? '📐 DIV' : '✅';
            if (result.ok)
              console.log(`   ${tag} [ALERTA] ${sig.signal} ${sym} ${tf} (Score: ${sig.score}/8)`);
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
  console.log('║  Motor Autónomo 24/7 INICIADO  v7        ║');
  console.log('║  MACD + ADX + Div RSI + Anti-Contra      ║');
  console.log('║  Horario México activado                 ║');
  console.log('╚══════════════════════════════════════════╝');
  STATE.daemonActive = true;
  runCycle(config);
  setInterval(() => runCycle(config), 3 * 60 * 1000);
}
