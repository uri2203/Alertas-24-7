// ═══════════════════════════════════════════════════════════════
//  engine/regime.js  —  Trading Dashboard PRO v8.0
//  Market Regime Detection: Trending / Ranging / Volatile / Breakout
//  Pure math — no I/O, fully testable
// ═══════════════════════════════════════════════════════════════

import { ema, calcATR, calcADX, calcRSI } from './signals.js';

// ── ADX-BASED REGIME ────────────────────────────────────────────
// ADX > 25 = trending, ADX < 20 = ranging
// DI+/DI- give direction
export function detectRegimeADX(candles) {
  if (!candles || candles.length < 60) return null;
  const adx = calcADX(candles, 14);
  if (!adx) return null;

  const atr = calcATR(candles, 14);
  const atrPct = atr && candles.length > 0 ? atr / candles[candles.length - 1].close : 0;

  if (adx.value > 30) return { regime: 'trending', strength: adx.value, direction: adx.dir, atrPct };
  if (adx.value > 25) return { regime: 'trending', strength: adx.value, direction: adx.dir, atrPct };
  if (adx.value < 18) return { regime: 'ranging', strength: adx.value, direction: null, atrPct };
  return { regime: 'transitional', strength: adx.value, direction: adx.dir, atrPct };
}

// ── VOLATILITY-BASED REGIME ─────────────────────────────────────
// Compara ATR actual con ATR histórico
export function detectRegimeVolatility(candles, lookback = 50) {
  if (!candles || candles.length < lookback + 14) return null;

  const atrCurrent = calcATR(candles, 14);
  const atrHistory = [];
  for (let i = lookback; i < candles.length - 14; i++) {
    const a = calcATR(candles.slice(0, i + 14), 14);
    if (a) atrHistory.push(a);
  }
  if (atrHistory.length < 10 || !atrCurrent) return null;

  const avgATR = atrHistory.reduce((a, b) => a + b, 0) / atrHistory.length;
  const stdATR = Math.sqrt(atrHistory.reduce((a, b) => a + (b - avgATR) ** 2, 0) / atrHistory.length);
  const zScore = stdATR > 0 ? (atrCurrent - avgATR) / stdATR : 0;

  if (zScore > 2) return { regime: 'volatile', zScore, atrCurrent, avgATR };
  if (zScore > 1) return { regime: 'elevated', zScore, atrCurrent, avgATR };
  if (zScore < -1) return { regime: 'compressed', zScore, atrCurrent, avgATR };
  return { regime: 'normal', zScore, atrCurrent, avgATR };
}

// ── EMA SLOPE REGIME ────────────────────────────────────────────
// Pendiente de EMAs para detectar tendencia
export function detectRegimeTrend(candles) {
  if (!candles || candles.length < 100) return null;
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const n = closes.length - 1;

  if (ema20[n] == null || ema50[n] == null) return null;

  const slope20 = n >= 5 && ema20[n - 5] ? (ema20[n] - ema20[n - 5]) / ema20[n - 5] : 0;
  const slope50 = n >= 10 && ema50[n - 10] ? (ema50[n] - ema50[n - 10]) / ema50[n - 10] : 0;

  const ema20Above = ema20[n] > ema50[n];
  const strongTrend = Math.abs(slope20) > 0.002;

  if (ema20Above && slope20 > 0 && strongTrend) return { regime: 'bull_trend', slope20, slope50 };
  if (!ema20Above && slope20 < 0 && strongTrend) return { regime: 'bear_trend', slope20, slope50 };
  if (Math.abs(slope20) < 0.0005) return { regime: 'flat', slope20, slope50 };
  return { regime: 'weak_trend', slope20, slope50 };
}

// ── PRICE ACTION REGIME ─────────────────────────────────────────
// Basado en relación precio-EMA y estructura de highs/lows
export function detectRegimePriceAction(candles, lookback = 20) {
  if (!candles || candles.length < lookback + 10) return null;
  const recent = candles.slice(-lookback);
  const closes = recent.map(c => c.close);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);

  // Higher highs / higher lows = uptrend
  let higherHighs = 0, higherLows = 0, lowerHighs = 0, lowerLows = 0;
  for (let i = 1; i < recent.length; i++) {
    if (highs[i] > highs[i - 1]) higherHighs++;
    if (lows[i] > lows[i - 1]) higherLows++;
    if (highs[i] < highs[i - 1]) lowerHighs++;
    if (lows[i] < lows[i - 1]) lowerLows++;
  }

  const bullishStructure = higherHighs > lookback * 0.6 && higherLows > lookback * 0.6;
  const bearishStructure = lowerHighs > lookback * 0.6 && lowerLows > lookback * 0.6;

  // Range: price oscillates between fixed levels
  const range = Math.max(...highs) - Math.min(...lows);
  const midRange = (Math.max(...highs) + Math.min(...lows)) / 2;
  const pricePos = (closes[closes.length - 1] - Math.min(...lows)) / range;
  const isRangeBound = range / midRange < 0.05 && !bullishStructure && !bearishStructure;

  if (bullishStructure) return { regime: 'bull_structure', pricePos };
  if (bearishStructure) return { regime: 'bear_structure', pricePos };
  if (isRangeBound) return { regime: 'range_bound', pricePos };
  return { regime: 'choppy', pricePos };
}

// ── RSI REGIME ──────────────────────────────────────────────────
export function detectRegimeRSI(candles) {
  if (!candles || candles.length < 30) return null;
  const rsi = calcRSI(candles, 14);
  if (!rsi) return null;

  if (rsi.value > 70) return { regime: 'overbought', rsi: rsi.value };
  if (rsi.value < 30) return { regime: 'oversold', rsi: rsi.value };
  if (rsi.value > 55) return { regime: 'bullish_momentum', rsi: rsi.value };
  if (rsi.value < 45) return { regime: 'bearish_momentum', rsi: rsi.value };
  return { regime: 'neutral', rsi: rsi.value };
}

// ── COMPOSITE REGIME ────────────────────────────────────────────
// Combina todos los detectores para un veredicto final
export function detectRegime(candles) {
  if (!candles || candles.length < 100) return { regime: 'unknown', confidence: 0 };

  const adxRegime = detectRegimeADX(candles);
  const volRegime = detectRegimeVolatility(candles);
  const trendRegime = detectRegimeTrend(candles);
  const paRegime = detectRegimePriceAction(candles);
  const rsiRegime = detectRegimeRSI(candles);

  // Scoring de votos
  const votes = {};

  if (adxRegime) {
    const r = adxRegime.regime;
    votes[r] = (votes[r] || 0) + 2; // ADX tiene más peso
  }
  if (trendRegime) {
    const r = trendRegime.regime;
    votes[r] = (votes[r] || 0) + 2;
  }
  if (paRegime) {
    const r = paRegime.regime;
    votes[r] = (votes[r] || 0) + 1;
  }
  if (rsiRegime) {
    const r = rsiRegime.regime;
    votes[r] = (votes[r] || 0) + 1;
  }

  // Clasificar en categorías principales
  let trending = 0, ranging = 0, volatile = 0, direction = null;

  for (const [regime, count] of Object.entries(votes)) {
    if (regime.includes('trend') || regime.includes('bull') || regime.includes('bear')) {
      trending += count;
      if (regime.includes('bull')) direction = direction || 'up';
      if (regime.includes('bear')) direction = direction || 'dn';
    }
    if (regime.includes('rang') || regime.includes('flat') || regime.includes('range') || regime.includes('neutral')) {
      ranging += count;
    }
    if (regime.includes('volatile') || regime.includes('elevated')) {
      volatile += count;
    }
  }

  const total = trending + ranging + volatile;
  let finalRegime, confidence;

  if (trending >= ranging && trending >= volatile && trending > 0) {
    finalRegime = 'trending';
    confidence = trending / total;
  } else if (volatile >= trending && volatile >= ranging && volatile > 0) {
    finalRegime = 'volatile';
    confidence = volatile / total;
  } else if (ranging > 0) {
    finalRegime = 'ranging';
    confidence = ranging / total;
  } else {
    finalRegime = 'unknown';
    confidence = 0;
  }

  return {
    regime: finalRegime,
    direction,
    confidence: +confidence.toFixed(2),
    trending, ranging, volatile,
    details: { adxRegime, volRegime, trendRegime, paRegime, rsiRegime },
  };
}

// ── REGIME SCORE BONUS ──────────────────────────────────────────
// Retorna ajuste al score basado en régimen
// Mercado en tendencia fuerte = +bonus
// Mercado lateral = -penalización
export function regimeScoreAdjustment(regime) {
  if (!regime || regime.regime === 'unknown') return 0;
  if (regime.regime === 'trending' && regime.confidence > 0.6) return 0.5;
  if (regime.regime === 'trending') return 0.3;
  if (regime.regime === 'volatile') return -0.3;
  if (regime.regime === 'ranging') return -0.5;
  return 0;
}
