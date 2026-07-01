// ═══════════════════════════════════════════════════════════════
//  engine/tracker.js  —  Trading Dashboard PRO v7.2
//  Registra cada señal enviada y evalúa resultados a 1h, 4h, 24h
//  Almacenamiento: archivo JSON local (sin dependencias externas)
// ═══════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { liveLearn } from './agent.js';
import { closeTrade } from './journal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'tracker.json');

// Asegurar que existe el directorio data/
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ── LEER/ESCRIBIR LOCAL ──────────────────────────────────────────
function readSignals() {
  try {
    if (!existsSync(DATA_FILE)) return [];
    const raw = readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[TRACKER] Error leyendo ${DATA_FILE}: ${e.message}`);
    return [];
  }
}

function writeSignals(signals) {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(signals, null, 2), 'utf8');
  } catch (e) {
    console.error(`[TRACKER] Error escribiendo ${DATA_FILE}: ${e.message}`);
  }
}

// ── REGISTRAR SEÑAL ENVIADA ───────────────────────────────────────
export async function trackSignal(sym, tf, sig, isDivergence = false, extra = {}) {
  const signals = readSignals();
  const record  = {
    id:           `${sym}-${tf}-${Date.now()}`,
    sym, tf,
    signal:       sig.signal,
    dir:          sig.dir,
    score:        sig.score,
    max:          sig.max,
    entryPrice:   sig.price,
    entry:        sig.entry,
    sl:           sig.sl,
    t1:           sig.t1,
    t2:           sig.t2,
    atr:          sig.atr || null,
    isDivergence,
    divValid:     sig.divValid || false,
    rules:        sig.rules,
    sentAt:       new Date().toISOString(),
    result1h:     null,
    result4h:     null,
    result24h:    null,
    price1h:      null,
    price4h:      null,
    price24h:     null,
    evaluated:    false,
    journalId:    extra.journalId || null,
    newsScore:    extra.newsScore || 0,
    candles:      extra.candles || null,
  };

  signals.unshift(record);
  if (signals.length > 500) signals.splice(500);
  writeSignals(signals);
  console.log(`[TRACKER] ✍️  Señal registrada: ${sig.signal} ${sym} ${tf} @ ${sig.price}`);
}

// ── EVALUAR RESULTADOS PENDIENTES ─────────────────────────────────
export async function evaluatePending(fetchCandlesFn) {
  const signals = readSignals();
  if (!signals.length) return;

  let   modified = false;
  const now      = Date.now();

  for (const rec of signals) {
    if (rec.evaluated) continue;
    const elapsed = now - new Date(rec.sentAt).getTime();

    let currentPrice = null;
    try {
      const candles = await fetchCandlesFn(rec.sym, '1m', 2);
      currentPrice  = candles?.[candles.length - 1]?.close || null;
    } catch (_) {}
    if (!currentPrice) continue;

    const isLong     = rec.signal === 'LONG';
    const calcResult = (ref, cur) =>
      (!ref || !cur) ? null : (isLong ? cur > ref : cur < ref) ? 'WIN' : 'LOSS';

    if (!rec.result1h  && elapsed >= 1  * 60 * 60 * 1000) { rec.price1h  = currentPrice; rec.result1h  = calcResult(rec.entryPrice, currentPrice); modified = true; triggerLiveLearn(rec, '1h'); }
    if (!rec.result4h  && elapsed >= 4  * 60 * 60 * 1000) { rec.price4h  = currentPrice; rec.result4h  = calcResult(rec.entryPrice, currentPrice); modified = true; triggerLiveLearn(rec, '4h'); }
    if (!rec.result24h && elapsed >= 24 * 60 * 60 * 1000) { rec.price24h = currentPrice; rec.result24h = calcResult(rec.entryPrice, currentPrice); rec.evaluated = true; modified = true; triggerLiveLearn(rec, '24h'); }
  }

  if (modified) {
    writeSignals(signals);
    console.log(`[TRACKER] 📊 Resultados actualizados.`);
  }
}

// ── LIVE LEARNING + JOURNAL HOOK ────────────────────────────────
function triggerLiveLearn(rec, timeframe) {
  const result = rec[`result${timeframe}`];
  if (!result) return;

  const pnl = rec.entryPrice ? ((rec[`price${timeframe}`] - rec.entryPrice) / rec.entryPrice * (rec.signal === 'LONG' ? 1 : -1)) : 0;

  // Live Learning: actualizar Q-table con resultado real
  try {
    liveLearn({
      candles: rec.candles || [],
      direction: rec.signal,
      entryPrice: rec.entryPrice,
      exitPrice: rec[`price${timeframe}`],
      result,
      newsScore: rec.newsScore || 0,
    });
  } catch (_) {}

  // Trade Journal: cerrar trade con resultado
  try {
    if (rec.journalId) {
      closeTrade(rec.journalId, {
        exitPrice: rec[`price${timeframe}`],
        exitTime: new Date().toISOString(),
        exitReason: `evaluated_${timeframe}`,
      });
    }
  } catch (_) {}
}

// ── ESTADÍSTICAS ──────────────────────────────────────────────────
export function getStats() {
  const signals = readSignals();
  if (!signals.length) return { ok: true, total: 0, signals: [] };

  const calc = (arr, field) => {
    const valid = arr.filter(s => s[field] !== null);
    if (!valid.length) return null;
    const wins = valid.filter(s => s[field] === 'WIN').length;
    const losses = valid.length - wins;
    return {
      wins, losses, total: valid.length,
      pct: Math.round(wins / valid.length * 100),
      profitFactor: losses > 0 ? +(wins / losses).toFixed(2) : wins > 0 ? Infinity : 0,
    };
  };

  const byPair = {}, byTF = {}, byScore = {};
  const byDir  = { LONG: { wins1h: 0, total1h: 0, wins4h: 0, total4h: 0 }, SHORT: { wins1h: 0, total1h: 0, wins4h: 0, total4h: 0 } };
  const bySession = {};

  for (const s of signals) {
    if (!byPair[s.sym]) byPair[s.sym] = [];
    byPair[s.sym].push(s);
    if (!byTF[s.tf]) byTF[s.tf] = [];
    byTF[s.tf].push(s);

    // Por rango de score
    const scoreBucket = s.score >= 9 ? '9-11' : s.score >= 7.5 ? '7.5-9' : '7-7.5';
    if (!byScore[scoreBucket]) byScore[scoreBucket] = [];
    byScore[scoreBucket].push(s);

    // Por sesión
    const hour = new Date(s.sentAt).toLocaleString('en-US', { timeZone: 'America/Mexico_City', hour: 'numeric', hour12: false });
    const h = parseInt(hour);
    let sess = 'Madrugada';
    if (h >= 8 && h < 12)  sess = 'Mañana';
    if (h >= 12 && h < 14) sess = 'Mediodía';
    if (h >= 14 && h < 18) sess = 'Tarde';
    if (h >= 18 && h < 20) sess = 'Atardecer';
    if (h >= 20 && h < 24) sess = 'Noche';
    if (!bySession[sess]) bySession[sess] = [];
    bySession[sess].push(s);

    if (s.result1h && byDir[s.signal]) {
      byDir[s.signal].total1h++;
      if (s.result1h === 'WIN') byDir[s.signal].wins1h++;
    }
    if (s.result4h && byDir[s.signal]) {
      byDir[s.signal].total4h++;
      if (s.result4h === 'WIN') byDir[s.signal].wins4h++;
    }
  }

  const condFails = {};
  for (const s of signals)
    if (s.rules)
      for (const [k, v] of Object.entries(s.rules))
        if (typeof v === 'boolean' && !v)
          condFails[k] = (condFails[k] || 0) + 1;

  const topFail = Object.entries(condFails).sort((a, b) => b[1] - a[1])[0];

  // Calcular métricas avanzadas
  const evaluated = signals.filter(s => s.evaluated);
  const totalWins = evaluated.filter(s => s.result24h === 'WIN').length;
  const totalLosses = evaluated.filter(s => s.result24h === 'LOSS').length;
  const winRate = evaluated.length > 0 ? Math.round(totalWins / evaluated.length * 100) : 0;

  return {
    ok: true,
    total:   signals.length,
    pending: signals.filter(s => !s.evaluated).length,
    evaluated: evaluated.length,
    metrics: {
      winRate24h: winRate,
      profitFactor: totalLosses > 0 ? +(totalWins / totalLosses).toFixed(2) : totalWins > 0 ? Infinity : 0,
      totalWins,
      totalLosses,
    },
    overall: {
      h1:  calc(signals, 'result1h'),
      h4:  calc(signals, 'result4h'),
      h24: calc(signals, 'result24h'),
    },
    byPair: Object.entries(byPair).map(([sym, arr]) => ({
      sym, total: arr.length, h1: calc(arr, 'result1h'), h4: calc(arr, 'result4h'),
    })).sort((a, b) => b.total - a.total).slice(0, 10),
    byTF: Object.entries(byTF).map(([tf, arr]) => ({
      tf, total: arr.length, h1: calc(arr, 'result1h'), h4: calc(arr, 'result4h'),
    })).sort((a, b) => b.total - a.total),
    byScore: Object.entries(byScore).map(([range, arr]) => ({
      range, total: arr.length, h1: calc(arr, 'result1h'), h4: calc(arr, 'result4h'),
    })).sort((a, b) => b.total - a.total),
    bySession: Object.entries(bySession).map(([name, arr]) => ({
      name, total: arr.length, h1: calc(arr, 'result1h'), h4: calc(arr, 'result4h'),
    })),
    byDir: {
      LONG:  {
        total: byDir.LONG.total1h,  pct1h: byDir.LONG.total1h  ? Math.round(byDir.LONG.wins1h  / byDir.LONG.total1h  * 100) : null,
        total4h: byDir.LONG.total4h, pct4h: byDir.LONG.total4h ? Math.round(byDir.LONG.wins4h / byDir.LONG.total4h * 100) : null,
      },
      SHORT: {
        total: byDir.SHORT.total1h, pct1h: byDir.SHORT.total1h ? Math.round(byDir.SHORT.wins1h / byDir.SHORT.total1h * 100) : null,
        total4h: byDir.SHORT.total4h, pct4h: byDir.SHORT.total4h ? Math.round(byDir.SHORT.wins4h / byDir.SHORT.total4h * 100) : null,
      },
    },
    topFailingCondition: topFail ? { name: topFail[0], count: topFail[1] } : null,
    signals: signals.slice(0, 50),
  };
}
