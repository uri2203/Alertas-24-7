// ═══════════════════════════════════════════════════════════════
//  engine/signals.js
//  Pure math — no I/O, no side effects, fully testable
// ═══════════════════════════════════════════════════════════════

// ── EMA ─────────────────────────────────────────────────────────
export function ema(values, period) {
  const k = 2 / (period + 1);
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
// Retorna el RSI actual (último valor) y su dirección
export function calcRSI(candles, period = 14) {
  if (!candles || candles.length < period + 2) return null;
  const closes = candles.map(c => c.close);
  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains  += diff;
    else           losses -= diff;
  }

  let avgGain = gains  / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }

  if (avgLoss === 0) return { value: 100, rising: true };
  const rs  = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  // Dirección del RSI: comparar últimas 3 velas
  const n = closes.length;
  const prevDiff = closes[n - 2] - closes[n - 3];
  const currDiff = closes[n - 1] - closes[n - 2];
  const rising   = currDiff > prevDiff;

  return { value: rsi, rising };
}

// ── VOLUMEN RELATIVO ─────────────────────────────────────────────
// Retorna true si el volumen actual supera el promedio de las últimas N velas
export function isVolumeAboveAvg(candles, period = 20) {
  if (!candles || candles.length < period + 1) return false;
  const vols   = candles.slice(-period - 1, -1).map(c => c.vol);
  const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
  const curVol = candles[candles.length - 1].vol;
  return curVol > avgVol * 1.1; // al menos 10% sobre el promedio
}

// ── HURST FLD ────────────────────────────────────────────────────
export function calcFLD(candles, period) {
  const half = Math.floor(period / 2);
  const out = [];
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

// ── PIVOT POINTS (Classic) ───────────────────────────────────────
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
    r236: H - d * 0.236,
    r382: H - d * 0.382,
    r500: H - d * 0.500,
    r618: H - d * 0.618,
    r786: H - d * 0.786,
    e1272: H + d * 0.272,
    e1618: H + d * 0.618,
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
  const maxIdx = bins.indexOf(Math.max(...bins));
  return L + (maxIdx + 0.5) * step;
}

// ── SWING DETECTION ──────────────────────────────────────────────
export function detectSwings(candles, lookback) {
  const out = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i-j].high >= candles[i].high || candles[i+j].high >= candles[i].high) isH = false;
      if (candles[i-j].low  <= candles[i].low  || candles[i+j].low  <= candles[i].low)  isL = false;
    }
    if (isH) out.push({ time: candles[i].time, p: candles[i].high, t: 'H', idx: i });
    if (isL) out.push({ time: candles[i].time, p: candles[i].low,  t: 'L', idx: i });
  }
  return out.sort((a, b) => a.time - b.time);
}

// ── ELLIOTT WAVE DETECTION ───────────────────────────────────────
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
      const w2r = (w[1].p - w[2].p) / w1; if (w2r < 0.30 || w2r > 0.82) continue;
      const w3  = w[3].p - w[2].p; if (w3 < w1 * 0.88) continue;
      const w4r = (w[3].p - w[4].p) / w3; if (w4r < 0.18 || w4r > 0.65) continue;
      if (w[4].p <= w[1].p) continue;
      found.push({ pts: w.slice(0, Math.min(6, w.length)), dir: 'up', w1, w2r, w3ext: w3 / w1, w4r, labels: cfg.labels, degree: cfg.degree, origin: w[0].p, tf });
    }

    if (!up && w.length >= 5) {
      const w1  = w[0].p - w[1].p; if (w1 <= 0) continue;
      const w2r = (w[2].p - w[1].p) / w1; if (w2r < 0.30 || w2r > 0.82) continue;
      const w3  = w[2].p - w[3].p; if (w3 < w1 * 0.88) continue;
      const w4r = (w[4].p - w[3].p) / w3; if (w4r < 0.18 || w4r > 0.65) continue;
      if (w[4].p >= w[1].p) continue;
      found.push({ pts: w.slice(0, 5), dir: 'dn', w1, w2r, w3ext: w3 / w1, w4r, labels: cfg.labels, degree: cfg.degree, origin: w[0].p, tf });
    }
  }
  return found.slice(-2);
}

// ── TIMEFRAME MAYOR ──────────────────────────────────────────────
// Dado un TF menor, devuelve el TF mayor para confirmación
export const TF_PARENT = {
  '1m':  '15m',
  '5m':  '1h',
  '15m': '1h',
  '1h':  '4h',
  '4h':  '1d',
  '1d':  null,  // 1d se valida solo, no tiene padre
};

// Análisis rápido del TF mayor: FLD direction + RSI side
// Retorna 'up', 'dn', o null si no hay consenso
export function scoreTFMayor(candles, tf) {
  if (!candles || candles.length < 60) return null;
  const hp     = (TF_CONFIG[tf] || TF_CONFIG['1h']).hurstP;
  const price  = candles[candles.length - 1].close;
  const fdA    = calcFLD(candles, hp[0]);
  const fdB    = calcFLD(candles, hp[1]);
  const fldAv  = fdA.length ? fdA[fdA.length - 1].value : null;
  const fldBv  = fdB.length ? fdB[fdB.length - 1].value : null;

  let fldDir = null;
  if (fldAv && fldBv) {
    if (price > fldAv && price > fldBv)      fldDir = 'up';
    else if (price < fldAv && price < fldBv) fldDir = 'dn';
  }

  const rsi = calcRSI(candles, 14);
  if (!fldDir || !rsi) return null;

  // FLD y RSI deben apuntar en la misma dirección
  if (fldDir === 'up' && rsi.value < 65) return 'up'; // alcista sin sobrecompra
  if (fldDir === 'dn' && rsi.value > 35) return 'dn'; // bajista sin sobreventa
  return null;
}

// ── SIGNAL SCORING ───────────────────────────────────────────────
// 6 condiciones:
//   1. FLD Hurst alineado        (TF actual)
//   2. Zona Fibonacci 38.2–61.8% (TF actual)
//   3. Pivote cercano ±0.5%      (TF actual)
//   4. Elliott detectado         (TF actual)
//   5. RSI confirmando + Volumen (TF actual)
//   6. TF mayor alineado         (pasa candles del TF superior)
//
// candidateMayorCandles: candles del TF padre (puede ser null para 1d)
export function scoreSignal(candles, tf, TF_CONFIG, candidateMayorCandles = null) {
  if (!candles || candles.length < 60) return null;

  const price = candles[candles.length - 1].close;
  const piv   = calcPivots(candles);
  const fib   = calcFibonacci(candles);
  const vpoc  = calcVPOC(candles.slice(-100));
  const hp    = (TF_CONFIG[tf] || TF_CONFIG['1h']).hurstP;

  // ── 1. FLD Hurst ──────────────────────────────────────────────
  const fdA    = calcFLD(candles, hp[0]);
  const fdB    = calcFLD(candles, hp[1]);
  const fldAv  = fdA.length ? fdA[fdA.length - 1].value : null;
  const fldBv  = fdB.length ? fdB[fdB.length - 1].value : null;
  let   fldDir = null;
  if (fldAv && fldBv) {
    if (price > fldAv && price > fldBv)      fldDir = 'up';
    else if (price < fldAv && price < fldBv) fldDir = 'dn';
  }

  // ── 2. Zona Fibonacci ─────────────────────────────────────────
  const inFib = fib && price >= fib.r618 && price <= fib.r382;

  // ── 3. Pivote ±0.5% ──────────────────────────────────────────
  let pvOk = false;
  if (piv) {
    for (const v of [piv.PP, piv.R1, piv.S1])
      if (Math.abs(price - v) / price < 0.005) { pvOk = true; break; }
  }

  // ── 4. Elliott detectado ──────────────────────────────────────
  const waves = detectElliott(candles, tf, TF_CONFIG);
  const w1ok  = waves && waves.length > 0;

  // ── 5. RSI confirmando dirección + Volumen sobre promedio ─────
  const rsi       = calcRSI(candles, 14);
  const volOk     = isVolumeAboveAvg(candles, 20);
  let   rsiVolumeOk = false;
  if (rsi && fldDir) {
    const rsiAligned = fldDir === 'up'
      ? (rsi.value < 65 && rsi.rising)    // alcista: RSI subiendo sin sobrecompra
      : (rsi.value > 35 && !rsi.rising);  // bajista: RSI bajando sin sobreventa
    rsiVolumeOk = rsiAligned && volOk;
  }

  // ── 6. TF mayor alineado ──────────────────────────────────────
  let tfMayorOk = false;
  if (tf === '1d') {
    // 1d no tiene padre — se apoya en su propio RSI/FLD
    tfMayorOk = fldDir !== null;
  } else if (candidateMayorCandles) {
    const parentTf  = TF_PARENT[tf];
    const mayorDir  = scoreTFMayor(candidateMayorCandles, parentTf);
    tfMayorOk       = mayorDir === fldDir;
  }

  // ── SCORE FINAL ───────────────────────────────────────────────
  const rules = { fldDir, inFib, pvOk, w1ok, rsiVolumeOk, tfMayorOk };
  const score = [fldDir !== null, inFib, pvOk, w1ok, rsiVolumeOk, tfMayorOk].filter(Boolean).length;
  const max   = 6;
  const dir   = fldDir;

  if (score >= 5 && dir) {
    const isUp = dir === 'up';
    return {
      signal: isUp ? 'LONG' : 'SHORT',
      score, max, dir, price,
      entry: isUp ? fib.r618 : fib.r382,
      sl:    isUp ? fib.L    : fib.H,
      t1:    isUp ? fib.r382 : fib.r618,
      t2:    isUp ? fib.r236 : fib.r786,
      vpoc, rules,
      time: new Date().toISOString(),
    };
  }

  return {
    signal: 'WAIT', score, max, dir, price, vpoc, rules,
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
