// ═══════════════════════════════════════════════════════════════
//  engine/scanner.js  —  Trading Dashboard PRO v8.0
//  Motor de Escaneo Autónomo 24/7 con ML + Regime + Risk
// ═══════════════════════════════════════════════════════════════
import { scoreSignal, TF_CONFIG, TF_PARENT } from './signals.js';
import { sendTelegram, buildAlertMessage }    from './telegram.js';
import { trackSignal, evaluatePending }       from './tracker.js';
import { detectRegime, regimeScoreAdjustment } from './regime.js';
import { extractFeatures, LogisticClassifier } from './ml.js';
import { calcPositionSize, kellyFraction } from './risk.js';

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
  ml:           { trained: false, confidence: 0, filtered: 0, total: 0, correct: 0 },
  regime:       { trending: 0, ranging: 0, volatile: 0, blocked: 0 },
};

const alertCooldown  = {};
const lastDirSent    = {};
const mayorCache     = {};
const MAYOR_CACHE_MS = 3 * 60 * 1000;
const ANTI_CONTRA_MS = 15 * 60 * 1000;

// ── ML CLASSIFIER GLOBAL ─────────────────────────────────────────
let mlClassifier = new LogisticClassifier();
let mlTrainData  = [];

// ── CORRELACION ──────────────────────────────────────────────────
const CORR_GROUPS = [
  ['BTCUSDT'],
  ['ETHUSDT'],
  ['SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'DOGEUSDT', 'XRPUSDT'],
  ['LINKUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'NEARUSDT'],
];
const sentThisCycle = new Map();

// ── SESION ACTIVA ────────────────────────────────────────────────
function getSession() {
  const mxStr  = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
  const mxDate = new Date(mxStr);
  const h      = mxDate.getHours() + mxDate.getMinutes() / 60;

  if (h >= 8  && h < 12) return { name: 'Manana', minScore: 7.0, cooldownMs: 15 * 60 * 1000 };
  if (h >= 12 && h < 14) return { name: 'Mediodia', minScore: 7.5, cooldownMs: 20 * 60 * 1000 };
  if (h >= 14 && h < 18) return { name: 'Tarde',  minScore: 7.0, cooldownMs: 15 * 60 * 1000 };
  if (h >= 18 && h < 20) return { name: 'Atardecer', minScore: 7.5, cooldownMs: 20 * 60 * 1000 };
  if (h >= 20 && h < 24) return { name: 'Noche',  minScore: 7.5, cooldownMs: 20 * 60 * 1000 };
  if (h >= 0  && h < 8)  return { name: 'Madrugada', minScore: 8.0, cooldownMs: 20 * 60 * 1000 };
  return null;
}

// ── FILTRO ANTI-CONTRADICCION ────────────────────────────────────
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

// ── CANDLES TF MAYOR con cache ───────────────────────────────────
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

// ── ML: ENTRENAR CON DATOS HISTORICOS ────────────────────────────
async function trainMLClassifier(config) {
  console.log('[ML] Entrenando clasificador con datos historicos...');
  let totalSamples = 0;
  const trainData = [];

  for (const sym of config.symbols) {
    for (const tf of config.tfs) {
      try {
        const candles = await fetchCandles(sym, tf, 500);
        if (!candles || candles.length < 250) continue;

        const WINDOW = 200;
        for (let i = WINDOW; i < candles.length - 50; i += 10) {
          const window = candles.slice(0, i + 1);
          const sig = scoreSignal(window, tf, TF_CONFIG);
          if (!sig || sig.signal === 'WAIT') continue;

          const features = extractFeatures(window, tf);
          if (!features) continue;

          const entryPrice = candles[i].close;
          const atr = sig.atr || 1;
          const future = candles.slice(i + 1, i + 51);
          if (future.length < 10) continue;

          let won = false;
          const sl = sig.signal === 'LONG' ? entryPrice - atr * 2 : entryPrice + atr * 2;
          const tp = sig.signal === 'LONG' ? entryPrice + atr * 2 : entryPrice - atr * 2;

          for (const fc of future) {
            if (sig.signal === 'LONG') {
              if (fc.low <= sl) { won = false; break; }
              if (fc.high >= tp) { won = true; break; }
            } else {
              if (fc.high >= sl) { won = false; break; }
              if (fc.low <= tp) { won = true; break; }
            }
          }
          if (!future.some(fc =>
            (sig.signal === 'LONG' && (fc.low <= sl || fc.high >= tp)) ||
            (sig.signal === 'SHORT' && (fc.high >= sl || fc.low <= tp))
          )) {
            const lastPrice = future[future.length - 1].close;
            won = sig.signal === 'LONG' ? lastPrice > entryPrice : lastPrice < entryPrice;
          }

          trainData.push({ features, label: won ? 1 : 0 });
          totalSamples++;
        }
        await new Promise(r => setTimeout(r, 300));
      } catch (e) { /* skip */ }
    }
  }

  if (trainData.length >= 20) {
    const X = trainData.map(d => d.features);
    const y = trainData.map(d => d.label);
    mlClassifier.train(X, y, 300, 0.01);
    STATE.ml.trained = true;
    const accuracy = mlClassifier.evaluate(X, y);
    console.log(`[ML] Entrenado con ${totalSamples} muestras. Accuracy: ${(accuracy * 100).toFixed(1)}%`);
  } else {
    console.log(`[ML] Insuficientes muestras (${totalSamples}). ML desactivado.`);
  }
}

// ── REGIME + ML FILTER EN SEÑAL ──────────────────────────────────
function applyMLRegimeFilter(candles, tf, sig) {
  if (!sig || sig.signal === 'WAIT') return sig;

  // 1. REGIME DETECTION
  const regime = detectRegime(candles);
  if (regime) {
    if (regime.regime === 'trending') STATE.regime.trending++;
    else if (regime.regime === 'ranging') STATE.regime.ranging++;
    else if (regime.regime === 'volatile') STATE.regime.volatile++;

    // Bloquear mercados laterales con alta confianza
    if (regime.regime === 'ranging' && regime.confidence > 0.7) {
      STATE.regime.blocked++;
      console.log(`   [REGIME] Ranging (${(regime.confidence * 100).toFixed(0)}%) - bloqueado`);
      return { ...sig, signal: 'WAIT', regimeBlocked: true };
    }

    // Ajustar score por regime
    const regimeAdj = regimeScoreAdjustment(regime);
    sig.score += regimeAdj;
    sig.regime = regime.regime;
    sig.regimeConfidence = regime.confidence;
  }

  // 2. ML CLASSIFIER
  if (STATE.ml.trained) {
    const features = extractFeatures(candles, tf);
    if (features) {
      const mlProb = mlClassifier.predict(features);
      STATE.ml.total++;
      STATE.ml.confidence += mlProb;

      // ML threshold: 0.45 minimo para permitir
      if (mlProb < 0.45) {
        STATE.ml.filtered++;
        console.log(`   [ML] Senal filtrada (prob: ${(mlProb * 100).toFixed(1)}%)`);
        return { ...sig, signal: 'WAIT', mlFiltered: true, mlProb };
      }
      sig.mlConfidence = mlProb;
    }
  }

  // Verificar score minimo despues de ajustes
  const session = getSession();
  if (session && sig.score < session.minScore) {
    return { ...sig, signal: 'WAIT' };
  }

  return sig;
}

// ── CICLO DE ESCANEO ─────────────────────────────────────────────
async function runCycle(config) {
  if (STATE.isScanning) return;

  if (STATE.paused) {
    STATE.session = 'Pausado';
    console.log('[SCANNER] Pausado - evaluando resultados pendientes...');
    await evaluatePending(fetchCandles).catch(() => {});
    return;
  }

  const session = getSession();
  STATE.session = session ? session.name : 'Fuera de horario';
  if (!session) {
    console.log('[SCANNER] Fuera de horario.');
    await evaluatePending(fetchCandles).catch(() => {});
    return;
  }

  STATE.isScanning = true;
  STATE.scanCount++;
  STATE.lastScan = new Date().toISOString();

  console.log(`\n[SCAN #${STATE.scanCount}] Sesion: ${session.name} | Score>=${session.minScore}/14 | ML: ${STATE.ml.trained ? 'ON' : 'OFF'}`);

  const activeThisCycle = new Set();
  sentThisCycle.clear();

  for (const sym of config.symbols) {
    for (const tf of config.tfs) {
      const key = `${sym}-${tf}`;
      try {
        const candles      = await fetchCandles(sym, tf);
        const mayorCandles = await getMayorCandles(sym, tf);

        if (candles && candles.length)
          STATE.prices[sym] = candles[candles.length - 1].close;

        let sig = scoreSignal(candles, tf, TF_CONFIG, mayorCandles);
        if (!sig || sig.signal === 'WAIT') continue;

        // Aplicar filtros ML + Regime
        sig = applyMLRegimeFilter(candles, tf, sig);
        if (!sig || sig.signal === 'WAIT') continue;

        // Filtro anti-contradiccion
        if (isContradicted(sym, sig.dir)) {
          const last    = lastDirSent[sym];
          const restMin = Math.ceil((ANTI_CONTRA_MS - (Date.now() - last.time)) / 60000);
          console.log(`   [ANTI-CONTRA] ${sym} ${tf} - ${sig.signal} bloqueado (espera ${restMin} min)`);
          continue;
        }

        // Filtro de correlacion
        const group = CORR_GROUPS.find(g => g.includes(sym)) || [sym];
        const groupKey = group.sort().join('-');
        const existing = sentThisCycle.get(groupKey);
        if (existing) {
          if (existing.dir === sig.dir) {
            if (sig.score - existing.score < 1.5) {
              console.log(`   [CORR] ${sym} ${tf} - ${sig.signal} (${sig.score}) descartada, ${existing.sym} ya tiene ${existing.dir} (${existing.score})`);
              continue;
            }
            console.log(`   [CORR] ${sym} ${tf} - ${sig.signal} (${sig.score}) supera a ${existing.sym} (${existing.score})`);
          }
        }
        sentThisCycle.set(groupKey, { dir: sig.dir, score: sig.score, sym, tf });

        activeThisCycle.add(key);
        const isDivergence = sig.divValid && sig.divergence;
        STATE.signals[key] = {
          sym, tf, ...sig, isDivergence,
          regime: sig.regime || 'unknown',
          mlConfidence: sig.mlConfidence || null,
        };

        const now = Date.now();
        if (!alertCooldown[key] || now - alertCooldown[key] > session.cooldownMs) {
          alertCooldown[key] = now;
          registerSent(sym, sig.dir);

          const text = buildAlertMessage(sym, tf, sig, isDivergence);
          if (config.telegram.token && config.telegram.chatId) {
            const result = await sendTelegram(config.telegram.token, config.telegram.chatId, text);
            const tag = isDivergence ? 'DIV' : 'ALERTA';
            if (result.ok) {
              const mlTag = sig.mlConfidence ? ` ML:${(sig.mlConfidence * 100).toFixed(0)}%` : '';
              const regimeTag = sig.regime ? ` [${sig.regime}]` : '';
              console.log(`   [${tag}] ${sig.signal} ${sym} ${tf} Score:${sig.score}/14${regimeTag}${mlTag}`);
              await trackSignal(sym, tf, sig, isDivergence).catch(() => {});
            } else {
              console.log(`   [ERR TELEGRAM] ${JSON.stringify(result)}`);
            }
          }
        }

      } catch (e) {
        console.error(`   [ERR] Scanner ${sym}/${tf}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 600));
    }
  }

  // Limpiar senales vencidas
  const before = Object.keys(STATE.signals).length;
  for (const key of Object.keys(STATE.signals))
    if (!activeThisCycle.has(key)) delete STATE.signals[key];
  const removed = before - Object.keys(STATE.signals).length;
  if (removed > 0) console.log(`   ${removed} senal(es) vencida(s) eliminada(s).`);

  await evaluatePending(fetchCandles).catch(() => {});

  STATE.isScanning = false;
  const mlAvg = STATE.ml.total > 0 ? (STATE.ml.confidence / STATE.ml.total * 100).toFixed(1) : 0;
  console.log(`[SCAN #${STATE.scanCount}] OK. Senales: ${Object.keys(STATE.signals).length} | ML: ${STATE.ml.filtered}/${STATE.ml.total} filtradas (${mlAvg}% avg) | Regime blocked: ${STATE.regime.blocked}`);
}

// ── INICIO ───────────────────────────────────────────────────────
export async function startScanner(config) {
  console.log('================================================');
  console.log('  Motor Autonomo 24/7  v8.0');
  console.log('  ML Classifier + Regime Detection + Risk');
  console.log('  Tracker de resultados ACTIVO');
  console.log('  Horario Mexico activado');
  console.log('================================================');
  STATE.daemonActive = true;

  // Entrenar ML al iniciar
  try {
    await trainMLClassifier(config);
  } catch (e) {
    console.error('[ML] Error entrenando:', e.message);
  }

  runCycle(config);
  setInterval(() => runCycle(config), 3 * 60 * 1000);
}
