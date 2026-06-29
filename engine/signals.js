// ═══════════════════════════════════════════════════════════════
//  engine/signals.js  —  Trading Dashboard PRO v8.0
//  Base v7.1 + filtros de tendencia + OBV + R:R
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

// ── RSI DINÁMICO — percentil en ventana ──────────────────────────
export function calcRSIDynamic(candles, period = 14, window = 50) {
  if (!candles || candles.length < period + window) return null;
  const rsiValues = [];
  for (let i = window; i <= candles.length - period; i++) {
    const r = calcRSI(candles.slice(0, i + period), period);
    if (r) rsiValues.push(r.value);
  }
  if (rsiValues.length < 10) return null;
  const sorted = [...rsiValues].sort((a, b) => a - b);
  const p20 = sorted[Math.floor(sorted.length * 0.2)];
  const p30 = sorted[Math.floor(sorted.length * 0.3)];
  const p70 = sorted[Math.floor(sorted.length * 0.7)];
  const p80 = sorted[Math.floor(sorted.length * 0.8)];
  const current = calcRSI(candles, period);
  return { value: current?.value, rising: current?.rising, p20, p30, p70, p80 };
}

// ── ATR (Average True Range) ────────────────────────────────────
export function calcATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low;
    const pc = candles[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (tr.length < period) return null;
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++)
    atr = (atr * (period - 1) + tr[i]) / period;
  return atr;
}

// ── DIVERGENCIA RSI ───────────────────────────────────────────────
export function calcRSIDivergence(candles, period = 14, lookback = 30) {
  if (!candles || candles.length < period + lookback + 5) return null;
  const seg    = candles.slice(-lookback);
  const closes = seg.map(c => c.close);
  const lows   = seg.map(c => c.low);
  const highs  = seg.map(c => c.high);
  const rsiSeries = [];
  for (let i = 0; i < seg.length; i++) {
    const slice = candles.slice(-(lookback - i + period + 2), candles.length - (lookback - i - 1) || undefined);
    const r     = calcRSI(slice, period);
    rsiSeries.push(r ? r.value : null);
  }
  const last = seg.length - 1, prev = Math.floor(seg.length / 2);
  if (rsiSeries[last] == null || rsiSeries[prev] == null) return null;
  if (lows[last] < lows[prev] && rsiSeries[last] > rsiSeries[prev]) return 'bullish';
  if (highs[last] > highs[prev] && rsiSeries[last] < rsiSeries[prev]) return 'bearish';
  return null;
}

// ── MACD ─────────────────────────────────────────────────────────
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
  const n = macdLine.length - 1;
  const sigVal = signalLine[n], macdVal = macdLine[n];
  if (sigVal == null) return null;
  const histogram = macdVal - sigVal;
  const prevHist  = macdLine[n - 1] - (signalLine[n - 1] || 0);
  const dir = macdVal > sigVal && histogram > prevHist ? 'up'
            : macdVal < sigVal && histogram < prevHist ? 'dn' : null;
  return { macdVal, sigVal, histogram, dir };
}

// ── ADX con DI+/DI- ─────────────────────────────────────────────
export function calcADX(candles, period = 14) {
  if (!candles || candles.length < period * 2 + 2) return null;
  const trueRanges = [], plusDM = [], minusDM = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high, low = candles[i].low;
    const pHigh = candles[i-1].high, pLow = candles[i-1].low, pClose = candles[i-1].close;
    trueRanges.push(Math.max(high - low, Math.abs(high - pClose), Math.abs(low - pClose)));
    const upMove = high - pHigh, downMove = pLow - low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smooth = (arr) => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
    return out;
  };
  const sTR = smooth(trueRanges), sPDM = smooth(plusDM), sMDM = smooth(minusDM);
  const dx = [], pdiArr = [], mdiArr = [];
  for (let i = 0; i < sTR.length; i++) {
    if (sTR[i] === 0) { dx.push(0); pdiArr.push(0); mdiArr.push(0); continue; }
    const pdi = (sPDM[i] / sTR[i]) * 100, mdi = (sMDM[i] / sTR[i]) * 100;
    pdiArr.push(pdi); mdiArr.push(mdi);
    dx.push(Math.abs(pdi - mdi) / (pdi + mdi) * 100);
  }
  if (dx.length < period) return null;
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
  const lastDIPlus = pdiArr[pdiArr.length-1] || 0, lastDIMinus = mdiArr[mdiArr.length-1] || 0;
  const diDir = lastDIPlus > lastDIMinus ? 'up' : lastDIMinus > lastDIPlus ? 'dn' : null;
  return { value: adx, trending: adx > 25, diPlus: lastDIPlus, diMinus: lastDIMinus, dir: diDir };
}

// ── VOLUMEN RELATIVO ─────────────────────────────────────────────
export function isVolumeAboveAvg(candles, period = 20) {
  if (!candles || candles.length < period + 1) return false;
  const vols = candles.slice(-period - 1, -1).map(c => c.vol);
  const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
  return candles[candles.length - 1].vol > avgVol * 1.1;
}

// ── OBV (On-Balance Volume) — NUEVO ─────────────────────────────
export function calcOBV(candles, period = 20) {
  if (!candles || candles.length < period + 1) return null;
  let obv = 0;
  const obvSeries = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i-1].close) obv += candles[i].vol;
    else if (candles[i].close < candles[i-1].close) obv -= candles[i].vol;
    obvSeries.push(obv);
  }
  if (obvSeries.length < period) return null;
  const recent = obvSeries.slice(-period);
  const half = Math.floor(period / 2);
  const avgRecent = recent.slice(half).reduce((a, b) => a + b, 0) / (period - half);
  const avgPrev = recent.slice(0, half).reduce((a, b) => a + b, 0) / half;
  return { value: obv, rising: avgRecent > avgPrev };
}

// ── EMA TREND — NUEVO ───────────────────────────────────────────
export function detectTrend(candles) {
  if (!candles || candles.length < 200) return null;
  const closes = candles.map(c => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const n = closes.length - 1;
  if (ema50[n] == null || ema200[n] == null) return null;
  const price = closes[n];
  const above50 = price > ema50[n], above200 = price > ema200[n];
  const goldenCross = ema50[n] > ema200[n];
  const ema200Slope = n >= 10 && ema200[n-10] ? (ema200[n] - ema200[n-10]) / ema200[n-10] : 0;
  let dir = null;
  // Usar posición del precio vs EMA200 + golden/death cross
  if (above200 && goldenCross) dir = 'up';
  else if (!above200 && !goldenCross) dir = 'dn';
  // Pendiente fuerte confirma
  if (ema200Slope > 0.003) dir = 'up';
  else if (ema200Slope < -0.003) dir = 'dn';
  return { dir, above50, above200, goldenCross, ema50: ema50[n], ema200: ema200[n], ema200Slope };
}

// ── CANDLE PATTERNS — NUEVO ─────────────────────────────────────
export function detectCandlePatterns(candles, lookback = 5) {
  if (!candles || candles.length < lookback + 2) return { bullish: false, bearish: false };
  const recent = candles.slice(-lookback);
  let bullish = 0, bearish = 0;
  for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    const body = Math.abs(c.close - c.open), range = c.high - c.low;
    if (range === 0) continue;
    if (c.close > c.open && (c.low < c.open - body * 2) && body/range < 0.35) bullish++;
    if (c.close < c.open && (c.high > c.open + body * 2) && body/range < 0.35) bearish++;
    if (i > 0) {
      const p = recent[i-1];
      if (p.close < p.open && c.close > c.open && c.close > p.open && c.open < p.close) bullish++;
      if (p.close > p.open && c.close < c.open && c.close < p.open && c.open > p.close) bearish++;
    }
  }
  return { bullish: bullish >= 1, bearish: bearish >= 1 };
}

// ── HURST FLD ────────────────────────────────────────────────────
export function calcFLD(candles, period) {
  const half = Math.floor(period / 2), out = [];
  for (let i = half; i < candles.length; i++)
    out.push({ time: candles[i].time, value: candles[i - half].close });
  return out;
}

// ── PIVOT POINTS ─────────────────────────────────────────────────
export function calcPivots(candles) {
  const n = candles.length;
  if (n < 8) return null;
  const seg = candles.slice(-Math.min(60, n - 4), -3);
  const H = Math.max(...seg.map(c => c.high)), L = Math.min(...seg.map(c => c.low));
  const C = candles[n - 4].close, PP = (H + L + C) / 3;
  return { PP, R1: 2*PP-L, R2: PP+H-L, R3: H+2*(PP-L), S1: 2*PP-H, S2: PP-(H-L), S3: L-2*(H-PP) };
}

// ── FIBONACCI ────────────────────────────────────────────────────
export function calcFibonacci(candles, lookback = 150) {
  const seg = candles.slice(-Math.min(lookback, candles.length));
  const H = Math.max(...seg.map(c => c.high)), L = Math.min(...seg.map(c => c.low)), d = H - L;
  return { H, L, r236: H-d*.236, r382: H-d*.382, r500: H-d*.5, r618: H-d*.618, r786: H-d*.786, e1272: H+d*.272, e1618: H+d*.618 };
}

// ── FIBONACCI BOUNCE ─────────────────────────────────────────────
export function detectFibBounce(candles, fib, atr, tolerance) {
  if (!fib || !atr || !candles || candles.length < 5) return null;
  const tol = tolerance || atr * 0.5;
  const levels = [
    { name: 'r786', val: fib.r786 }, { name: 'r618', val: fib.r618 },
    { name: 'r500', val: fib.r500 }, { name: 'r382', val: fib.r382 }, { name: 'r236', val: fib.r236 },
  ];
  const recent = candles.slice(-15);
  for (const lv of levels) {
    const touches = recent.filter(c => Math.abs(c.low - lv.val) < tol || Math.abs(c.high - lv.val) < tol);
    if (touches.length === 0) continue;
    const last = recent[recent.length - 1];
    if (last.close > lv.val && last.low <= lv.val + tol) return { level: lv.name, direction: 'bullish', price: lv.val };
    if (last.close < lv.val && last.high >= lv.val - tol) return { level: lv.name, direction: 'bearish', price: lv.val };
  }
  return null;
}

// ── VPOC ─────────────────────────────────────────────────────────
export function calcVPOC(candles, buckets = 50) {
  if (!candles || candles.length < 10) return null;
  const H = Math.max(...candles.map(c => c.high)), L = Math.min(...candles.map(c => c.low));
  if (H === L) return L;
  const step = (H - L) / buckets, bins = new Array(buckets).fill(0);
  candles.forEach(c => { const b = Math.min(buckets-1, Math.floor(((c.high+c.low)/2 - L) / step)); bins[b] += c.vol; });
  return L + (bins.indexOf(Math.max(...bins)) + 0.5) * step;
}

// ── SWING DETECTION ──────────────────────────────────────────────
export function detectSwings(candles, lookback) {
  const out = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i-j].high > candles[i].high || candles[i+j].high > candles[i].high) isH = false;
      if (candles[i-j].low < candles[i].low || candles[i+j].low < candles[i].low) isL = false;
    }
    if (isH) out.push({ time: candles[i].time, p: candles[i].high, t: 'H', idx: i });
    if (isL) out.push({ time: candles[i].time, p: candles[i].low, t: 'L', idx: i });
  }
  return out.sort((a, b) => a.time - b.time);
}

// ── ELLIOTT WAVE ─────────────────────────────────────────────────
export function detectElliott(candles, tf, TF_CONFIG) {
  const lb = Math.max(3, Math.floor(candles.length / 35));
  const sw = detectSwings(candles, lb);
  const cfg = TF_CONFIG[tf] || TF_CONFIG['1h'];
  const found = [];
  for (let i = 0; i + 4 < sw.length; i++) {
    const w = sw.slice(i, i + 6);
    let alt = true;
    for (let j = 1; j < w.length; j++) if (w[j].t === w[j-1].t) { alt = false; break; }
    if (!alt) continue;
    const up = w[0].t === 'L';
    if (up && w.length >= 5) {
      const w1 = w[1].p - w[0].p; if (w1 <= 0) continue;
      const w2r = (w[1].p - w[2].p) / w1; if (w2r < .25 || w2r > .85) continue;
      const w3 = w[3].p - w[2].p; if (w3 < w1 * .70) continue;
      const w4r = (w[3].p - w[4].p) / w3; if (w4r < .15 || w4r > .70) continue;
      if (w[4].p <= w[1].p) continue;
      found.push({ pts: w.slice(0, Math.min(6, w.length)), dir: 'up', w1, w2r, w3ext: w3/w1, w4r, labels: cfg.labels, degree: cfg.degree, origin: w[0].p, tf });
    }
    if (!up && w.length >= 5) {
      const w1 = w[0].p - w[1].p; if (w1 <= 0) continue;
      const w2r = (w[2].p - w[1].p) / w1; if (w2r < .25 || w2r > .85) continue;
      const w3 = w[2].p - w[3].p; if (w3 < w1 * .70) continue;
      const w4r = (w[4].p - w[3].p) / w3; if (w4r < .15 || w4r > .70) continue;
      if (w[4].p >= w[1].p) continue;
      found.push({ pts: w.slice(0, 5), dir: 'dn', w1, w2r, w3ext: w3/w1, w4r, labels: cfg.labels, degree: cfg.degree, origin: w[0].p, tf });
    }
  }
  return found.slice(-2);
}

// ── TF PADRE ─────────────────────────────────────────────────────
export const TF_PARENT = { '1m':'15m', '5m':'1h', '15m':'1h', '1h':'4h', '4h':'1d', '1d':null };

export function scoreTFMayor(candles, tf) {
  if (!candles || candles.length < 60) return null;
  const hp = (TF_CONFIG[tf] || TF_CONFIG['1h']).hurstP;
  const price = candles[candles.length-1].close;
  const fdA = calcFLD(candles, hp[0]), fdB = calcFLD(candles, hp[1]);
  const fldAv = fdA.length ? fdA[fdA.length-1].value : null;
  const fldBv = fdB.length ? fdB[fdB.length-1].value : null;
  let fldDir = null;
  if (fldAv && fldBv) {
    if (price > fldAv && price > fldBv) fldDir = 'up';
    else if (price < fldAv && price < fldBv) fldDir = 'dn';
  }
  const rsi = calcRSI(candles, 14);
  if (!fldDir || !rsi) return null;
  if (fldDir === 'up' && rsi.value < 65) return 'up';
  if (fldDir === 'dn' && rsi.value > 35) return 'dn';
  return null;
}

// ════════════════════════════════════════════════════════════════
//  SCORE PONDERADO v8.0 — Base v7.1 + mejoras selectivas
//
//  Condiciones (12 puntos totales):
//    EMA Trend  (1.0)  — filtro de tendencia dominante (200 EMA slope)
//    FLD Hurst  (2.0)  — señal principal de dirección
//    MACD dir   (2.0)  — confirmación de momentum
//    ADX+DI     (1.5)  — fuerza + dirección de tendencia
//    RSI+Vol    (1.5)  — confirmación de momentum
//    OBV        (1.0)  — flujo de volumen (NUEVO)
//    Elliott    (1.0)  — patrón de estructura
//    FibBounce  (1.0)  — rebote en nivel clave
//    Pivot      (1.0)  — proximidad a zona de control
//    TF Mayor   (1.0)  — alineación multi-timeframe
//    R:R        (1.0)  — ratio riesgo:beneficio mínimo (NUEVO)
//
//  Score mínimo: 8.0/12 (producción)
//  FILTRO DURO: EMA 200 trend bloquea señales en contra
// ════════════════════════════════════════════════════════════════
export function scoreSignal(candles, tf, TF_CONFIG, candidateMayorCandles = null) {
  if (!candles || candles.length < 60) return null;

  const price = candles[candles.length-1].close;
  const piv   = calcPivots(candles);
  const fib   = calcFibonacci(candles);
  const atr   = calcATR(candles, 14);
  const vpoc  = calcVPOC(candles.slice(-100));
  const hp    = (TF_CONFIG[tf] || TF_CONFIG['1h']).hurstP;

  // ── 1. EMA TREND (peso: 1.0) — FILTRO DOMINANTE ───────────────
  const trend = detectTrend(candles);

  // ── 2. FLD Hurst (peso: 2.0) ─────────────────────────────────
  const fdA = calcFLD(candles, hp[0]), fdB = calcFLD(candles, hp[1]);
  const fldAv = fdA.length ? fdA[fdA.length-1].value : null;
  const fldBv = fdB.length ? fdB[fdB.length-1].value : null;
  let fldDir = null;
  if (fldAv && fldBv) {
    if (price > fldAv && price > fldBv) fldDir = 'up';
    else if (price < fldAv && price < fldBv) fldDir = 'dn';
  }

  // ── 3. MACD (peso: 2.0) ─────────────────────────────────────
  const macd = calcMACD(candles);

  // ── 4. ADX+DI (peso: 1.5) ───────────────────────────────────
  const adx = calcADX(candles);

  // ── 5. RSI+Vol (peso: 1.5) ──────────────────────────────────
  const rsiDyn = calcRSIDynamic(candles, 14, 50);
  const volOk  = isVolumeAboveAvg(candles, 20);
  let rsiVolumeOk = false;
  if (rsiDyn && rsiDyn.value != null && fldDir) {
    const rsiAligned = fldDir === 'up'
      ? (rsiDyn.value < rsiDyn.p70 && rsiDyn.rising)
      : (rsiDyn.value > rsiDyn.p30 && !rsiDyn.rising);
    rsiVolumeOk = rsiAligned && volOk;
  }

  // ── 6. OBV (peso: 1.0) — NUEVO ──────────────────────────────
  const obv = calcOBV(candles, 20);

  // ── 7. Elliott (peso: 1.0) ──────────────────────────────────
  const waves = detectElliott(candles, tf, TF_CONFIG);
  const w1ok = waves && waves.length > 0;

  // ── 8. FibBounce (peso: 1.0) ────────────────────────────────
  const fibBounce = detectFibBounce(candles, fib, atr);
  const fibOk = fibBounce && fldDir && fibBounce.direction === (fldDir === 'up' ? 'bullish' : 'bearish');

  // ── 9. Pivot (peso: 1.0) ────────────────────────────────────
  let pvOk = false;
  if (piv) for (const v of [piv.PP, piv.R1, piv.S1]) if (Math.abs(price - v) / price < 0.003) { pvOk = true; break; }

  // ── 10. TF Mayor (peso: 1.0) ────────────────────────────────
  let tfMayorOk = false;
  if (tf !== '1d' && candidateMayorCandles) {
    const parentTf = TF_PARENT[tf];
    tfMayorOk = scoreTFMayor(candidateMayorCandles, parentTf) === fldDir;
  }

  // ── 11. R:R mínimo (peso: 1.0) — NUEVO ─────────────────────
  // (calculado después de SL/TP)

  // ── DIVERGENCIA ──────────────────────────────────────────────
  const divergence = calcRSIDivergence(candles, 14, 30);
  const divAligned = (fldDir === 'up' && divergence === 'bullish') || (fldDir === 'dn' && divergence === 'bearish');
  const divValid = divAligned && macd && macd.dir === fldDir && adx && adx.trending && adx.dir === fldDir;

  // ══ SCORING ═══════════════════════════════════════════════════
  const weights = { ema: 1.0, fld: 2.0, macd: 2.0, adx: 1.5, rsiVol: 1.5, obv: 1.0, elliott: 1.0, fib: 1.0, pivot: 1.0, tfMayor: 1.0, rr: 1.0 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  let score = 0;

  // 1. EMA Trend (1.0)
  let emaOk = false;
  if (trend && trend.dir === fldDir) { emaOk = true; score += weights.ema; }
  else if (trend && trend.dir === null) {
    if ((trend.above50 && fldDir === 'up') || (!trend.above50 && fldDir === 'dn')) { emaOk = true; score += weights.ema * 0.5; }
  }

  // 2. FLD (2.0)
  if (fldDir) score += weights.fld;

  // 3. MACD (2.0)
  let macdOk = false;
  if (macd && macd.dir === fldDir) { macdOk = true; score += weights.macd; }

  // 4. ADX (1.5)
  let adxOk = false;
  if (adx && adx.trending && adx.dir === fldDir) { adxOk = true; score += weights.adx; }

  // 5. RSI+Vol (1.5)
  if (rsiVolumeOk) score += weights.rsiVol;

  // 6. OBV (1.0)
  let obvOk = false;
  if (obv && ((fldDir === 'up' && obv.rising) || (fldDir === 'dn' && !obv.rising))) { obvOk = true; score += weights.obv; }

  // 7. Elliott (1.0)
  let elliottOk = false;
  if (w1ok && waves[0].dir === fldDir) { elliottOk = true; score += weights.elliott; }

  // 8. FibBounce (1.0)
  if (fibOk) score += weights.fib;

  // 9. Pivot (1.0)
  if (pvOk) score += weights.pivot;

  // 10. TF Mayor (1.0)
  if (tfMayorOk) score += weights.tfMayor;

  // ── FILTRO DURO DE TENDENCIA ──────────────────────────────────
  const trendBlocks = trend && trend.dir !== null && trend.dir !== fldDir;

  // ── CONDICIÓN MÍNIMA: FLD + al menos 2 de MACD/ADX/EMA ───────
  const hasDirection = fldDir && (macdOk ? 1 : 0) + (adxOk ? 1 : 0) + (emaOk ? 1 : 0) >= 2;

  const dir = fldDir;
  if (score >= 7.0 && dir && hasDirection && !trendBlocks) {
    const isUp = dir === 'up';
    const atrMult = atr || 0;

    // SL: ATR dinámico
    const fibSL = isUp ? fib.L : fib.H;
    const atrSL = isUp ? price - atrMult * 2 : price + atrMult * 2;
    let sl = fibSL;
    if (atrMult > 0 && Math.abs(price - fibSL) > atrMult * 3) sl = atrSL;

    // TP: R:R mínimo 1.5
    const slDist = Math.abs(price - sl);
    const minTP = slDist * 1.5;
    let t1 = isUp ? price + minTP : price - minTP;
    let t2 = isUp ? price + minTP * 2 : price - minTP * 2;
    const fibTP1 = isUp ? fib.r382 : fib.r618;
    const fibTP2 = isUp ? fib.r236 : fib.r786;
    if (isUp && fibTP1 > t1) t1 = fibTP1;
    if (isUp && fibTP2 > t2) t2 = fibTP2;
    if (!isUp && fibTP1 < t1) t1 = fibTP1;
    if (!isUp && fibTP2 < t2) t2 = fibTP2;

    // Verificar R:R
    const tp1Dist = Math.abs(t1 - price);
    const rr = slDist > 0 ? tp1Dist / slDist : 0;
    let rrOk = false;
    if (rr >= 1.0) { rrOk = true; score += weights.rr; }

    return {
      signal: isUp ? 'LONG' : 'SHORT',
      score: Math.round(score * 10) / 10, max: total, dir, price,
      entry: price, sl, t1, t2,
      vpoc, rules: { fldDir, macdOk, adxOk, emaOk, obvOk, elliottOk, fibOk, pvOk, tfMayorOk, rrOk, hasDirection, rsiVolumeOk, divergence: divergence || null, divValid, atr: atr || null, adx: adx || null, rsiDyn: rsiDyn || null, trend: trend || null },
      atr: atrMult, divergence: divergence || null, time: new Date().toISOString(),
    };
  }

  return { signal: 'WAIT', score: Math.round(score * 10) / 10, max: total, dir, price, vpoc, rules: { fldDir, macdOk, adxOk, emaOk, obvOk, elliottOk, fibOk, pvOk, tfMayorOk, hasDirection, rsiVolumeOk, divergence: divergence || null, divValid }, divergence: divergence || null, time: new Date().toISOString() };
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
