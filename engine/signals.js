// ═══════════════════════════════════════════════════════════════
//  engine/signals.js  —  Trading Dashboard PRO v7
//  Score de 8 condiciones + divergencia RSI como bonus
//  Pure math — no I/O, no side effects, fully testable
// ═══════════════════════════════════════════════════════════════

// ── EMA ─────────────────────────────────────────────────────────
export function ema(values, period) {
  const k      = 2 / (period + 1);
  const result = new Array(values.length).fill(null);
  if (period > values.length) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum / period;
  for (let i = period; i < values.length; i++)
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  return result;
}

// ── RSI ──────────────────────────────────────────────────────────
export function calcRSI(candles, period = 14) {
  if (!candles || candles.length < period + 2) return null;
  const closes = candles.map(c => c.close);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0))  / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return { value: 100, rising: true };
  const rsi    = 100 - (100 / (1 + avgGain / avgLoss));
  const n      = closes.length;
  const rising = (closes[n - 1] - closes[n - 2]) > (closes[n - 2] - closes[n - 3]);
  return { value: rsi, rising };
}

// ── DIVERGENCIA RSI ───────────────────────────────────────────────
// Busca divergencia alcista o bajista en las últimas N velas
// Alcista: precio hace nuevo mínimo pero RSI no → probable reversión al alza
// Bajista: precio hace nuevo máximo pero RSI no → probable reversión a la baja
export function calcRSIDivergence(candles, period = 14, lookback = 30) {
  if (!candles || candles.length < period + lookback + 5) return null;

  const seg    = candles.slice(-lookback);
  const closes = seg.map(c => c.close);
  const lows   = seg.map(c => c.low);
  const highs  = seg.map(c => c.high);

  // Calcular RSI para cada vela del segmento
  const rsiSeries = [];
  for (let i = 0; i < seg.length; i++) {
    const slice = candles.slice(-(lookback - i + period + 2), candles.length - (lookback - i - 1) || undefined);
    const r     = calcRSI(slice, period);
    rsiSeries.push(r ? r.value : null);
  }

  const last     = seg.length - 1;
  const prev     = Math.floor(seg.length / 2); // punto de comparación anterior

  if (rsiSeries[last] == null || rsiSeries[prev] == null) return null;

  // Divergencia alcista: precio mínimo más bajo, RSI mínimo más alto
  const bullDiv = lows[last] < lows[prev] && rsiSeries[last] > rsiSeries[prev];
  // Divergencia bajista: precio máximo más alto, RSI máximo más bajo
  const bearDiv = highs[last] > highs[prev] && rsiSeries[last] < rsiSeries[prev];

  if (bullDiv) return 'bullish';
  if (bearDiv) return 'bearish';
  return null;
}

// ── MACD ─────────────────────────────────────────────────────────
// Retorna { macdLine, signalLine, histogram, dir }
// dir: 'up' si MACD > signal y histograma creciendo, 'dn' si lo contrario
export function calcMACD(candles, fast = 12, slow = 26, signal = 9) {
  if (!candles || candles.length < slow + signal + 2) return null;
  const closes     = candles.map(c => c.close);
  const emaFast    = ema(closes, fast);
  const emaSlow    = ema(closes, slow);
  const macdLine   = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  ).filter(v => v !== null);

  if (macdLine.length < signal + 2) return null;
  const signalLine = ema(macdLine, signal);
  const n          = macdLine.length - 1;
  const sigVal     = signalLine[n];
  const macdVal    = macdLine[n];
  if (sigVal == null) return null;

  const histogram  = macdVal - sigVal;
  const prevHist   = macdLine[n - 1] - (signalLine[n - 1] || 0);

  // Dirección: MACD sobre signal line Y histograma creciendo (momentum real)
  const dir = macdVal > sigVal && histogram > prevHist ? 'up'
            : macdVal < sigVal && histogram < prevHist ? 'dn'
            : null;

  return { macdVal, sigVal, histogram, dir };
}

// ── ADX (Average Directional Index) ──────────────────────────────
// Mide la FUERZA de la tendencia (no su dirección)
// ADX > 25 = tendencia real → señales confiables
// ADX < 25 = mercado lateral → señales poco confiables
export function calcADX(candles, period = 14) {
  if (!candles || candles.length < period * 2 + 2) return null;

  const trueRanges = [], plusDM = [], minusDM = [];

  for (let i = 1; i < candles.length; i++) {
    const high  = candles[i].high;
    const low   = candles[i].low;
    const pHigh = candles[i - 1].high;
    const pLow  = candles[i - 1].low;
    const pClose= candles[i - 1].close;

    trueRanges.push(Math.max(high - low, Math.abs(high - pClose), Math.abs(low - pClose)));

    const upMove   = high - pHigh;
    const downMove = pLow  - low;
    plusDM.push( upMove > downMove && upMove > 0   ? upMove   : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Suavizado Wilder
  const smooth = (arr) => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) {
      s = s - s / period + arr[i];
      out.push(s);
    }
    return out;
  };

  const sTR  = smooth(trueRanges);
  const sPDM = smooth(plusDM);
  const sMDM = smooth(minusDM);

  const dx = [];
  for (let i = 0; i < sTR.length; i++) {
    if (sTR[i] === 0) { dx.push(0); continue; }
    const pdi = (sPDM[i] / sTR[i]) * 100;
    const mdi = (sMDM[i] / sTR[i]) * 100;
    dx.push(Math.abs(pdi - mdi) / (pdi + mdi) * 100);
  }

  if (dx.length < period) return null;
  // Wilder's smoothing for final ADX
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  return { value: adx, trending: adx > 25 };
}

// ── VOLUMEN RELATIVO ─────────────────────────────────────────────
export function isVolumeAboveAvg(candles, period = 20) {
  if (!candles || candles.length < period + 1) return false;
  const vols   = candles.slice(-period - 1, -1).map(c => c.vol);
  const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
  return candles[candles.length - 1].vol > avgVol * 1.1;
}

// ── HURST FLD ────────────────────────────────────────────────────
export function calcFLD(candles, period) {
  const half = Math.floor(period / 2);
  const out  = [];
  for (let i = half; i < candles.length; i++)
    out.push({ time: candles[i].time, value: candles[i - half].close });
  return out;
}

// ── HURST CMA ────────────────────────────────────────────────────
export function calcCMA(candles, period) {
  const closes = candles.map(c => c.close);
  const e1 = ema(closes, Math.floor(period / 2));
  const e2 = ema(closes, period);
  const out = [];
  for (let i = period - 1; i < candles.length; i++)
    if (e1[i] != null && e2[i] != null)
      out.push({ time: candles[i].time, value: 2 * e1[i] - e2[i] });
  return out;
}

// ── PIVOT POINTS ─────────────────────────────────────────────────
export function calcPivots(candles) {
  const n = candles.length;
  if (n < 8) return null;
  const seg = candles.slice(-Math.min(60, n - 4), -3);
  const H   = Math.max(...seg.map(c => c.high));
  const L   = Math.min(...seg.map(c => c.low));
  const C   = candles[n - 4].close;
  const PP  = (H + L + C) / 3;
  return {
    PP,
    R1: 2 * PP - L,  R2: PP + H - L,  R3: H + 2 * (PP - L),
    S1: 2 * PP - H,  S2: PP - (H - L), S3: L - 2 * (H - PP),
  };
}

// ── FIBONACCI ────────────────────────────────────────────────────
export function calcFibonacci(candles, lookback = 150) {
  const seg = candles.slice(-Math.min(lookback, candles.length));
  const H   = Math.max(...seg.map(c => c.high));
  const L   = Math.min(...seg.map(c => c.low));
  const d   = H - L;
  return {
    H, L,
    r236: H - d * 0.236, r382: H - d * 0.382,
    r500: H - d * 0.500, r618: H - d * 0.618,
    r786: H - d * 0.786, e1272: H + d * 0.272, e1618: H + d * 0.618,
  };
}

// ── VPOC ─────────────────────────────────────────────────────────
export function calcVPOC(candles, buckets = 50) {
  if (!candles || candles.length < 10) return null;
  const H    = Math.max(...candles.map(c => c.high));
  const L    = Math.min(...candles.map(c => c.low));
  if (H === L) return L;
  const step = (H - L) / buckets;
  const bins = new Array(buckets).fill(0);
  candles.forEach(c => {
    const mid = (c.high + c.low) / 2;
    const b   = Math.min(buckets - 1, Math.floor((mid - L) / step));
    bins[b]  += c.vol;
  });
  return L + (bins.indexOf(Math.max(...bins)) + 0.5) * step;
}

// ── SWING DETECTION ──────────────────────────────────────────────
export function detectSwings(candles, lookback) {
  const out = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i-j].high > candles[i].high || candles[i+j].high > candles[i].high) isH = false;
      if (candles[i-j].low  < candles[i].low  || candles[i+j].low  < candles[i].low)  isL = false;
    }
    if (isH) out.push({ time: candles[i].time, p: candles[i].high, t: 'H', idx: i });
    if (isL) out.push({ time: candles[i].time, p: candles[i].low,  t: 'L', idx: i });
  }
  return out.sort((a, b) => a.time - b.time);
}

// ── ELLIOTT WAVE ─────────────────────────────────────────────────
export function detectElliott(candles, tf, TF_CONFIG) {
  const lb  = Math.max(3, Math.floor(candles.length / 35));
  const sw  = detectSwings(candles, lb);
  const cfg = TF_CONFIG[tf] || TF_CONFIG['1h'];
  const found = [];

  for (let i = 0; i + 4 < sw.length; i++) {
    const w   = sw.slice(i, i + 6);
    let   alt = true;
    for (let j = 1; j < w.length; j++)
      if (w[j].t === w[j-1].t) { alt = false; break; }
    if (!alt) continue;

    const up = w[0].t === 'L';

    if (up && w.length >= 5) {
      const w1  = w[1].p - w[0].p; if (w1 <= 0) continue;
      const w2r = (w[1].p - w[2].p) / w1; if (w2r < .25 || w2r > .85) continue;
      const w3  = w[3].p - w[2].p; if (w3 < w1 * .70) continue;
      const w4r = (w[3].p - w[4].p) / w3; if (w4r < .15 || w4r > .70) continue;
      if (w[4].p <= w[1].p) continue;
      found.push({ pts: w.slice(0, Math.min(6, w.length)), dir: 'up', w1, w2r, w3ext: w3/w1, w4r, labels: cfg.labels, degree: cfg.degree, origin: w[0].p, tf });
    }

    if (!up && w.length >= 5) {
      const w1  = w[0].p - w[1].p; if (w1 <= 0) continue;
      const w2r = (w[2].p - w[1].p) / w1; if (w2r < .25 || w2r > .85) continue;
      const w3  = w[2].p - w[3].p; if (w3 < w1 * .70) continue;
      const w4r = (w[4].p - w[3].p) / w3; if (w4r < .15 || w4r > .70) continue;
      if (w[4].p >= w[1].p) continue;
      found.push({ pts: w.slice(0, 5), dir: 'dn', w1, w2r, w3ext: w3/w1, w4r, labels: cfg.labels, degree: cfg.degree, origin: w[0].p, tf });
    }
  }
  return found.slice(-2);
}

// ── TF PADRE ─────────────────────────────────────────────────────
export const TF_PARENT = {
  '1m': '15m', '5m': '1h', '15m': '1h',
  '1h': '4h',  '4h': '1d', '1d': null,
};

// Análisis rápido del TF mayor
export function scoreTFMayor(candles, tf) {
  if (!candles || candles.length < 60) return null;
  const hp    = (TF_CONFIG[tf] || TF_CONFIG['1h']).hurstP;
  const price = candles[candles.length - 1].close;
  const fdA   = calcFLD(candles, hp[0]);
  const fdB   = calcFLD(candles, hp[1]);
  const fldAv = fdA.length ? fdA[fdA.length - 1].value : null;
  const fldBv = fdB.length ? fdB[fdB.length - 1].value : null;
  let fldDir  = null;
  if (fldAv && fldBv) {
    if (price > fldAv && price > fldBv)      fldDir = 'up';
    else if (price < fldAv && price < fldBv) fldDir = 'dn';
  }
  const rsi = calcRSI(candles, 14);
  if (!fldDir || !rsi) return null;
  if (fldDir === 'up' && rsi.value < 65) return 'up';
  if (fldDir === 'dn' && rsi.value > 35) return 'dn';
  return null;
}

// ── SIGNAL SCORING — 8 condiciones + divergencia bonus ───────────
//
//  1. FLD Hurst alineado          (TF actual)
//  2. Zona Fibonacci 38.2–61.8%   (TF actual)
//  3. Pivote cercano ±0.5%        (TF actual)
//  4. Elliott detectado           (TF actual)
//  5. RSI confirmando + Volumen   (TF actual)
//  6. TF mayor alineado           (TF padre)
//  7. MACD confirmando dirección  (TF actual) ← NUEVO
//  8. ADX > 25 — mercado en tend. (TF actual) ← NUEVO
//  +  Divergencia RSI             (bonus, señal especial)
//
//  candidateMayorCandles: candles del TF padre (null para 1d)
// ════════════════════════════════════════════════════════════════
export function scoreSignal(candles, tf, TF_CONFIG, candidateMayorCandles = null) {
  if (!candles || candles.length < 60) return null;

  const price = candles[candles.length - 1].close;
  const piv   = calcPivots(candles);
  const fib   = calcFibonacci(candles);
  const vpoc  = calcVPOC(candles.slice(-100));
  const hp    = (TF_CONFIG[tf] || TF_CONFIG['1h']).hurstP;

  // ── 1. FLD Hurst ──────────────────────────────────────────────
  const fdA   = calcFLD(candles, hp[0]);
  const fdB   = calcFLD(candles, hp[1]);
  const fldAv = fdA.length ? fdA[fdA.length - 1].value : null;
  const fldBv = fdB.length ? fdB[fdB.length - 1].value : null;
  let fldDir  = null;
  if (fldAv && fldBv) {
    if (price > fldAv && price > fldBv)      fldDir = 'up';
    else if (price < fldAv && price < fldBv) fldDir = 'dn';
  }

  // ── 2. Zona Fibonacci ─────────────────────────────────────────
  const inFib = fib && price >= fib.r618 && price <= fib.r382;

  // ── 3. Pivote ±0.5% ──────────────────────────────────────────
  let pvOk = false;
  if (piv)
    for (const v of [piv.PP, piv.R1, piv.S1])
      if (Math.abs(price - v) / price < 0.005) { pvOk = true; break; }

  // ── 4. Elliott detectado ──────────────────────────────────────
  const waves = detectElliott(candles, tf, TF_CONFIG);
  const w1ok  = waves && waves.length > 0;

  // ── 5. RSI confirmando + Volumen ──────────────────────────────
  const rsi         = calcRSI(candles, 14);
  const volOk       = isVolumeAboveAvg(candles, 20);
  let rsiVolumeOk   = false;
  if (rsi && fldDir) {
    const rsiAligned = fldDir === 'up'
      ? (rsi.value < 65 && rsi.rising)
      : (rsi.value > 35 && !rsi.rising);
    rsiVolumeOk = rsiAligned && volOk;
  }

  // ── 6. TF mayor alineado ──────────────────────────────────────
  let tfMayorOk = false;
  if (tf === '1d') {
    // 1d has no parent — require at least 2 aligned conditions from lower TFs
    tfMayorOk = false; // Always requires parent candle validation
  } else if (candidateMayorCandles) {
    const parentTf = TF_PARENT[tf];
    tfMayorOk      = scoreTFMayor(candidateMayorCandles, parentTf) === fldDir;
  }

  // ── 7. MACD confirmando dirección ─────────────────────────────
  const macd    = calcMACD(candles);
  const macdOk  = macd && macd.dir === fldDir;

  // ── 8. ADX > 25 — mercado en tendencia (no lateral) ──────────
  const adx    = calcADX(candles);
  const adxOk  = adx && adx.trending;

  // ── DIVERGENCIA RSI — señal especial bonus ────────────────────
  const divergence    = calcRSIDivergence(candles, 14, 30);
  const hasBullDiv    = divergence === 'bullish';
  const hasBearDiv    = divergence === 'bearish';
  const divAligned    = (fldDir === 'up' && hasBullDiv) || (fldDir === 'dn' && hasBearDiv);

  // ── SCORE FINAL ───────────────────────────────────────────────
  const rules = {
    fldDir, inFib, pvOk, w1ok,
    rsiVolumeOk, tfMayorOk, macdOk, adxOk,
    divergence: divergence || null,
    nearVPOC: vpoc && Math.abs(price - vpoc) / price < 0.006,
  };

  const score = [
    fldDir !== null,  // 1
    inFib,            // 2
    pvOk,             // 3
    w1ok,             // 4
    rsiVolumeOk,      // 5
    tfMayorOk,        // 6
    macdOk,           // 7
    adxOk,            // 8
  ].filter(Boolean).length;

  const max = 8;
  const dir = fldDir;

  if ((score >= 6 || divAligned) && dir) {
    const isUp = dir === 'up';
    return {
      signal:    isUp ? 'LONG' : 'SHORT',
      score, max, dir, price,
      entry:     isUp ? fib.r618  : fib.r382,
      sl:        isUp ? fib.L     : fib.H,
      t1:        isUp ? fib.r382  : fib.r618,
      t2:        isUp ? fib.r236  : fib.r786,
      vpoc, rules,
      divergence: divergence || null,
      time: new Date().toISOString(),
    };
  }

  return {
    signal: 'WAIT', score, max, dir, price, vpoc, rules,
    divergence: divergence || null,
    time: new Date().toISOString(),
  };
}

// ── TF CONFIG ────────────────────────────────────────────────────
export const TF_CONFIG = {
  '1m':  { degree: 'Sub-Minuette', labels: ['i','ii','iii','iv','v'],          hurstP: [15,30,60] },
  '5m':  { degree: 'Minuette',     labels: ['ⅰ','ⅱ','ⅲ','ⅳ','ⅴ'],          hurstP: [20,40,80] },
  '15m': { degree: 'Minute',       labels: ['①','②','③','④','⑤'],           hurstP: [20,40,80] },
  '1h':  { degree: 'Minor',        labels: ['[1]','[2]','[3]','[4]','[5]'],    hurstP: [10,20,40] },
  '4h':  { degree: 'Intermediate', labels: ['(1)','(2)','(3)','(4)','(5)'],    hurstP: [8,16,32]  },
  '1d':  { degree: 'Primary',      labels: ['I','II','III','IV','V'],           hurstP: [5,10,20]  },
};
