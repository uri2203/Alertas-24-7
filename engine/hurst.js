// ═══════════════════════════════════════════════════════════════
//  engine/hurst.js  —  Hurst Exponent + FLD Real v8.0
//  R/S Analysis para detectar tendencia vs mean-reversion
//  "El mercado recuerda — Hurst mide cuánto recuerda"
// ═══════════════════════════════════════════════════════════════

// ── HURST EXPONENT (R/S Analysis) ───────────────────────────
// H > 0.5 = tendencial (persistente)
// H = 0.5 = random walk
// H < 0.5 = mean-reverting (antipersistente)
export function hurstExponent(candles, maxWindow = 100) {
  if (!candles || candles.length < 40) return null;

  const closes = candles.map(c => c.close);
  const n = closes.length;

  // Retornos logarítmicos
  const returns = [];
  for (let i = 1; i < n; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }

  if (returns.length < 20) return null;

  // R/S para múltiples ventanas
  const sizes = [];
  const rsValues = [];

  for (let size = 20; size <= Math.min(maxWindow, Math.floor(returns.length / 2)); size += 5) {
    const numWindows = Math.floor(returns.length / size);
    if (numWindows < 1) continue;

    let totalRS = 0;
    let count = 0;

    for (let w = 0; w < numWindows; w++) {
      const segment = returns.slice(w * size, (w + 1) * size);
      const mean = segment.reduce((a, b) => a + b, 0) / size;

      // Desviación acumulada
      const deviates = [];
      let cumDev = 0;
      for (let i = 0; i < size; i++) {
        cumDev += segment[i] - mean;
        deviates.push(cumDev);
      }

      // Rango
      const R = Math.max(...deviates) - Math.min(...deviates);

      // Desviación estándar
      const variance = segment.reduce((a, b) => a + (b - mean) ** 2, 0) / size;
      const S = Math.sqrt(variance);

      if (S > 0 && R > 0) {
        totalRS += R / S;
        count++;
      }
    }

    if (count > 0) {
      sizes.push(size);
      rsValues.push(totalRS / count);
    }
  }

  if (sizes.length < 3) return null;

  // Regresión lineal en log-log: log(R/S) = H * log(n) + c
  const logN = sizes.map(s => Math.log(s));
  const logRS = rsValues.map(rs => Math.log(rs));

  const result = linearRegression(logN, logRS);
  if (!result) return null;

  const H = Math.max(0, Math.min(1, result.slope)); // Clamp 0-1

  return {
    H: +H.toFixed(4),
    regime: H > 0.55 ? 'trending' : H < 0.45 ? 'mean_reverting' : 'random',
    confidence: Math.abs(H - 0.5) * 2, // 0-1: qué tan lejos de random
    sizes,
    rsValues,
    r2: result.r2,
  };
}

// ── REGRESIÓN LINEAL ────────────────────────────────────────
function linearRegression(x, y) {
  const n = x.length;
  if (n < 2) return null;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R²
  const meanY = sumY / n;
  const ssTot = y.reduce((a, b) => a + (b - meanY) ** 2, 0);
  const ssRes = y.reduce((a, b, i) => a + (b - (slope * x[i] + intercept)) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2: +r2.toFixed(4) };
}

// ── FLD REAL (basado en Hurst) ──────────────────────────────
// Future Line of Discrimination: EMA desplazada hacia adelante
export function calcFLDReal(candles, period) {
  if (!candles || candles.length < period + 10) return [];

  const closes = candles.map(c => c.close);
  const emaValues = ema(closes, period);
  if (!emaValues) return [];

  const half = Math.floor(period / 2);
  const out = [];

  // FLD: valor de EMA hace N/2 barras, proyectado N/2 barras hacia adelante
  for (let i = half; i < candles.length; i++) {
    const emaIdx = i - half;
    if (emaIdx >= 0 && emaIdx < emaValues.length && emaValues[emaIdx] != null) {
      out.push({
        time: candles[i].time,
        value: emaValues[emaIdx],
        index: i,
      });
    }
  }

  return out;
}

// ── EMA helper ──────────────────────────────────────────────
function ema(data, period) {
  if (!data || data.length < period) return null;
  const k = 2 / (period + 1);
  const result = new Array(data.length).fill(null);
  result[period - 1] = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ── DETERMINAR PERÍODOS ÓPTIMOS DE FLD ──────────────────────
// Usa Hurst para elegir períodos que capturen el ciclo dominante
export function optimalFLDPeriods(H, basePeriod = 20) {
  if (H == null) return [basePeriod, basePeriod * 2];

  // H > 0.5: tendencia fuerte → períodos más cortos (reaccionar rápido)
  // H < 0.5: mean-reversion → períodos más largos (esperar el rebote)
  const factor = H > 0.5 ? (1 - (H - 0.5)) : (1 + (0.5 - H));
  const p1 = Math.round(basePeriod * factor);
  const p2 = Math.round(basePeriod * factor * 2);

  return [Math.max(8, p1), Math.max(16, p2)];
}

// ── PHASE ANALYSIS (basado en Hurst) ────────────────────────
export function hurstPhase(candles, window = 50) {
  if (!candles || candles.length < window + 20) return null;

  const recent = candles.slice(-window);
  const h = hurstExponent(recent, window - 5);
  if (!h) return null;

  // Tendencia del precio
  const closes = recent.map(c => c.close);
  const firstHalf = closes.slice(0, Math.floor(closes.length / 2));
  const secondHalf = closes.slice(Math.floor(closes.length / 2));
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const priceTrend = avgSecond > avgFirst ? 'up' : avgSecond < avgFirst ? 'dn' : 'flat';

  // Determinar fase
  let phase;
  if (h.regime === 'trending' && priceTrend === 'up') phase = 'markup';
  else if (h.regime === 'trending' && priceTrend === 'dn') phase = 'markdown';
  else if (h.regime === 'mean_reverting' && priceTrend === 'up') phase = 'distribution';
  else if (h.regime === 'mean_reverting' && priceTrend === 'dn') phase = 'accumulation';
  else phase = 'transition';

  return {
    phase,
    H: h.H,
    regime: h.regime,
    priceTrend,
    confidence: h.confidence,
  };
}
