// ═══════════════════════════════════════════════════════════════
//  engine/signals.js  —  Trading Dashboard PRO v7.1
//  Score ponderado + ATR + Fibonacci bounce + Elliott corrección
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
// En vez de fijos 65/35, calcula los percentiles 30/70 de las
// últimas N velas para adaptarse a la tendencia actual
export function calcRSIDynamic(candles, period = 14, window = 50) {
  if (!candles || candles.length < period + window) return null;
  const rsiValues = [];
  for (let i = window; i <= candles.length - period; i++) {
    const r = calcRSI(candles.slice(0, i + period), period);
    if (r) rsiValues.push(r.value);
  }
  if (rsiValues.length < 10) return null;
  const sorted = [...rsiValues].sort((a, b) => a - b);
  const p30 = sorted[Math.floor(sorted.length * 0.3)];
  const p70 = sorted[Math.floor(sorted.length * 0.7)];
  const current = calcRSI(candles, period);
  return { value: current?.value, rising: current?.rising, p30, p70 };
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

  const last     = seg.length - 1;
  const prev     = Math.floor(seg.length / 2);

  if (rsiSeries[last] == null || rsiSeries[prev] == null) return null;

  const bullDiv = lows[last] < lows[prev] && rsiSeries[last] > rsiSeries[prev];
  const bearDiv = highs[last] > highs[prev] && rsiSeries[last] < rsiSeries[prev];

  if (bullDiv) return 'bullish';
  if (bearDiv) return 'bearish';
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
  const n          = macdLine.length - 1;
  const sigVal     = signalLine[n];
  const macdVal    = macdLine[n];
  if (sigVal == null) return null;

  const histogram  = macdVal - sigVal;
  const prevHist   = macdLine[n - 1] - (signalLine[n - 1] || 0);

  const dir = macdVal > sigVal && histogram > prevHist ? 'up'
            : macdVal < sigVal && histogram < prevHist ? 'dn'
            : null;

  return { macdVal, sigVal, histogram, dir };
}

// ── ADX con DI+/DI- ─────────────────────────────────────────────
// Retorna { value, trending, diPlus, diMinus, dir }
// dir: 'up' si DI+ > DI-, 'dn' si DI- > DI+
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

  const dx = [], pdiArr = [], mdiArr = [];
  for (let i = 0; i < sTR.length; i++) {
    if (sTR[i] === 0) { dx.push(0); pdiArr.push(0); mdiArr.push(0); continue; }
    const pdi = (sPDM[i] / sTR[i]) * 100;
    const mdi = (sMDM[i] / sTR[i]) * 100;
    pdiArr.push(pdi);
    mdiArr.push(mdi);
    dx.push(Math.abs(pdi - mdi) / (pdi + mdi) * 100);
  }

  if (dx.length < period) return null;
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }

  const lastDIPlus  = pdiArr[pdiArr.length - 1] || 0;
  const lastDIMinus = mdiArr[mdiArr.length - 1] || 0;
  const diDir = lastDIPlus > lastDIMinus ? 'up' : lastDIMinus > lastDIPlus ? 'dn' : null;

  return { value: adx, trending: adx > 25, diPlus: lastDIPlus, diMinus: lastDIMinus, dir: diDir };
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

// ── FIBONACCI BOUNCE ─────────────────────────────────────────────
// Detecta si el precio REBOTÓ recientemente en un nivel Fib
// Retorna { level, direction } o null
// direction: 'bullish' si rebotó en soporte (subiendo), 'bearish' si rechazó en resistencia (bajando)
export function detectFibBounce(candles, fib, atr, tolerance) {
  if (!fib || !atr || !candles || candles.length < 5) return null;
  const tol = tolerance || atr * 0.3;
  const levels = [
    { name: 'r786', val: fib.r786 },
    { name: 'r618', val: fib.r618 },
    { name: 'r500', val: fib.r500 },
    { name: 'r382', val: fib.r382 },
    { name: 'r236', val: fib.r236 },
  ];
  const recent = candles.slice(-10);
  for (const lv of levels) {
    const touches = recent.filter(c =>
      Math.abs(c.low - lv.val) < tol || Math.abs(c.high - lv.val) < tol
    );
    if (touches.length === 0) continue;
    const lastTouch = touches[touches.length - 1];
    const lastCandle = recent[recent.length - 1];
    // Bounce alcista: toca nivel por debajo y cierra arriba
    if (lastCandle.close > lv.val && lastCandle.low <= lv.val + tol) {
      return { level: lv.name, direction: 'bullish', price: lv.val };
    }
    // Rechazo bajista: toca nivel por arriba y cierra abajo
    if (lastCandle.close < lv.val && lastCandle.high >= lv.val - tol) {
      return { level: lv.name, direction: 'bearish', price: lv.val };
    }
  }
  return null;
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

// ── ELLIOTT WAVE (CORREGIDO) ─────────────────────────────────────
// Regla estricta: onda 4 NUNCA sobreponga territorio de onda 1
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
      // REGLA CRÍTICA: onda 4 no puede sobreponer onda 1
      if (w[4].p <= w[1].p) continue;
      found.push({ pts: w.slice(0, Math.min(6, w.length)), dir: 'up', w1, w2r, w3ext: w3/w1, w4r, labels: cfg.labels, degree: cfg.degree, origin: w[0].p, tf });
    }

    if (!up && w.length >= 5) {
      const w1  = w[0].p - w[1].p; if (w1 <= 0) continue;
      const w2r = (w[2].p - w[1].p) / w1; if (w2r < .25 || w2r > .85) continue;
      const w3  = w[2].p - w[3].p; if (w3 < w1 * .70) continue;
      const w4r = (w[4].p - w[3].p) / w3; if (w4r < .15 || w4r > .70) continue;
      // REGLA CRÍTICA: onda 4 no puede sobreponer onda 1
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

// ── SCORE PONDERADO — 8 condiciones + divergencia bonus ──────────
//
//  Ponderaciones:
//    FLD Hurst (2.0)  — señal principal de dirección
//    MACD dir  (2.0)  — confirmación de momentum
//    ADX+DI    (1.5)  — fuerza + dirección de tendencia
//    RSI+Vol   (1.5)  — confirmación de momentum
//    Elliott   (1.0)  — patrón de estructura
//    FibBounce (1.0)  — rebote en nivel clave
//    Pivot     (1.0)  — proximidad a zona de control
//    TF Mayor  (1.0)  — alineación multi-timeframe
//
//  Score total: 11.0 puntos
//  Mínimo para señal: 7.0 normal, 5.5 con divergencia alineada
// ════════════════════════════════════════════════════════════════
export function scoreSignal(candles, tf, TF_CONFIG, candidateMayorCandles = null) {
  if (!candles || candles.length < 60) return null;

  const price = candles[candles.length - 1].close;
  const piv   = calcPivots(candles);
  const fib   = calcFibonacci(candles);
  const atr   = calcATR(candles, 14);
  const vpoc  = calcVPOC(candles.slice(-100));
  const hp    = (TF_CONFIG[tf] || TF_CONFIG['1h']).hurstP;

  // ── 1. FLD Hurst (peso: 2.0) ─────────────────────────────────
  const fdA   = calcFLD(candles, hp[0]);
  const fdB   = calcFLD(candles, hp[1]);
  const fldAv = fdA.length ? fdA[fdA.length - 1].value : null;
  const fldBv = fdB.length ? fdB[fdB.length - 1].value : null;
  let fldDir  = null;
  if (fldAv && fldBv) {
    if (price > fldAv && price > fldBv)      fldDir = 'up';
    else if (price < fldAv && price < fldBv) fldDir = 'dn';
  }

  // ── 2. Fibonacci Bounce (peso: 1.0) ──────────────────────────
  const fibBounce = detectFibBounce(candles, fib, atr);
  const fibOk     = fibBounce && fldDir && fibBounce.direction === (fldDir === 'up' ? 'bullish' : 'bearish');

  // ── 3. Pivote ±0.3% (peso: 1.0) — más estricto ──────────────
  let pvOk = false;
  if (piv)
    for (const v of [piv.PP, piv.R1, piv.S1])
      if (Math.abs(price - v) / price < 0.003) { pvOk = true; break; }

  // ── 4. Elliott detectado (peso: 1.0) ─────────────────────────
  const waves = detectElliott(candles, tf, TF_CONFIG);
  const w1ok  = waves && waves.length > 0;

  // ── 5. RSI dinámico + Volumen (peso: 1.5) ────────────────────
  const rsiDyn     = calcRSIDynamic(candles, 14, 50);
  const volOk      = isVolumeAboveAvg(candles, 20);
  let rsiVolumeOk  = false;
  if (rsiDyn && rsiDyn.value != null && fldDir) {
    const rsiAligned = fldDir === 'up'
      ? (rsiDyn.value < rsiDyn.p70 && rsiDyn.rising)
      : (rsiDyn.value > rsiDyn.p30 && !rsiDyn.rising);
    rsiVolumeOk = rsiAligned && volOk;
  }

  // ── 6. TF mayor alineado (peso: 1.0) ─────────────────────────
  let tfMayorOk = false;
  if (tf !== '1d' && candidateMayorCandles) {
    const parentTf = TF_PARENT[tf];
    tfMayorOk      = scoreTFMayor(candidateMayorCandles, parentTf) === fldDir;
  }

  // ── 7. MACD confirmando dirección (peso: 2.0) ────────────────
  const macd   = calcMACD(candles);
  const macdOk = macd && macd.dir === fldDir;

  // ── 8. ADX con DI+/DI- (peso: 1.5) ──────────────────────────
  const adx   = calcADX(candles);
  const adxOk = adx && adx.trending && adx.dir === fldDir;

  // ── DIVERGENCIA RSI — bonus SOLO con confirmación fuerte ────────
  // La divergencia es señal contrarian. Para que sea válida necesita:
  //   1. MACD confirmando dirección (momentum real)
  //   2. ADX confirmando tendencia + dirección (fuerza real)
  // Sin esto, la divergencia es ruido.
  const divergence = calcRSIDivergence(candles, 14, 30);
  const hasBullDiv = divergence === 'bullish';
  const hasBearDiv = divergence === 'bearish';
  const divAligned = (fldDir === 'up' && hasBullDiv) || (fldDir === 'dn' && hasBearDiv);
  const divValid   = divAligned && macdOk && adxOk;

  // ── SCORE FINAL PONDERADO ─────────────────────────────────────
  const rules = {
    fldDir, fibOk, pvOk, w1ok,
    rsiVolumeOk, tfMayorOk, macdOk, adxOk,
    divergence: divergence || null,
    divValid,
    nearVPOC: vpoc && Math.abs(price - vpoc) / price < 0.006,
    atr: atr || null,
    adx: adx || null,
    rsiDyn: rsiDyn || null,
  };

  const weights = { fld: 2.0, macd: 2.0, adx: 1.5, rsiVol: 1.5, elliott: 1.0, fib: 1.0, pivot: 1.0, tfMayor: 1.0 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  let score = 0;
  if (fldDir)    score += weights.fld;
  if (macdOk)    score += weights.macd;
  if (adxOk)     score += weights.adx;
  if (rsiVolumeOk) score += weights.rsiVol;
  if (w1ok)      score += weights.elliott;
  if (fibOk)     score += weights.fib;
  if (pvOk)      score += weights.pivot;
  if (tfMayorOk) score += weights.tfMayor;

  const minNormal = 7.0;
  const dir       = fldDir;

  // Señal normal: score >= 7.0/11
  // Señal con divergencia: score >= 7.0/11 + MACD confirmado + ADX confirmado
  // La divergencia NO reduce el mínimo — solo agrega validación extra
  if (score >= minNormal && dir) {
    const isUp = dir === 'up';
    // SL/TP dinámicos con ATR
    const atrMult = atr || 0;
    const rawSL   = isUp ? fib.L : fib.H;
    const rawTP1  = isUp ? fib.r382 : fib.r618;
    const rawTP2  = isUp ? fib.r236 : fib.r786;
    // Ajustar SL: máximo 2x ATR del swing
    const maxSLDist = atrMult * 2;
    let sl = rawSL;
    if (maxSLDist > 0 && Math.abs(price - rawSL) > maxSLDist) {
      sl = isUp ? price - maxSLDist : price + maxSLDist;
    }

    return {
      signal:    isUp ? 'LONG' : 'SHORT',
      score: Math.round(score * 10) / 10,
      max: total, dir, price,
      entry:     isUp ? fib.r618  : fib.r382,
      sl,
      t1:        rawTP1,
      t2:        rawTP2,
      vpoc, rules,
      atr: atrMult,
      divergence: divergence || null,
      time: new Date().toISOString(),
    };
  }

  return {
    signal: 'WAIT', score: Math.round(score * 10) / 10, max: total, dir, price, vpoc, rules,
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
