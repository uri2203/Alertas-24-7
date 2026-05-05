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

// ── HURST FLD (real: price displaced N/2 bars forward) ───────────
// fldValues[i] = close[i - half] aligned to candle[i]
export function calcFLD(candles, period) {
  const half = Math.floor(period / 2);
  const out = [];
  for (let i = half; i < candles.length; i++)
    out.push({ time: candles[i].time, value: candles[i - half].close });
  return out;
}

// ── HURST CMA (DEMA de-lagged: 2×EMA(N/2) − EMA(N)) ─────────────
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
  const H  = Math.max(...seg.map(c => c.high));
  const L  = Math.min(...seg.map(c => c.low));
  const C  = candles[n - 4].close;
  const PP = (H + L + C) / 3;
  return {
    PP,
    R1: 2 * PP - L,  R2: PP + H - L,  R3: H + 2 * (PP - L),
    S1: 2 * PP - H,  S2: PP - (H - L), S3: L - 2 * (H - PP),
  };
}

// ── FIBONACCI retrace + extensions ──────────────────────────────
export function calcFibonacci(candles, lookback = 150) {
  const seg = candles.slice(-Math.min(lookback, candles.length));
  const H = Math.max(...seg.map(c => c.high));
  const L = Math.min(...seg.map(c => c.low));
  const d = H - L;
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

// ── VPOC (Volume Point of Control) ──────────────────────────────
// The price level where the most volume was traded.
// Acts as a price magnet and dynamic S/R.
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

// ── SWING DETECTION (structural highs/lows, not ZigZag %) ────────
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

// ── ELLIOTT WAVE DETECTION with Fibonacci ratio validation ────────
// Rules enforced:
//   W2 retraces W1 by 30–82%
//   W3 >= 88% of W1 (never shortest)
//   W4 does not overlap W1 territory
//   W4 retraces W3 by 18–65%
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
      const w1   = w[1].p - w[0].p; if (w1 <= 0) continue;
      const w2r  = (w[1].p - w[2].p) / w1; if (w2r < 0.30 || w2r > 0.82) continue;
      const w3   = w[3].p - w[2].p; if (w3 < w1 * 0.88) continue;
      const w4r  = (w[3].p - w[4].p) / w3; if (w4r < 0.18 || w4r > 0.65) continue;
      if (w[4].p <= w[1].p) continue;
      found.push({
        pts: w.slice(0, Math.min(6, w.length)),
        dir: 'up', w1, w2r, w3ext: w3 / w1, w4r,
        labels: cfg.labels, degree: cfg.degree, origin: w[0].p, tf,
      });
    }

    if (!up && w.length >= 5) {
      const w1   = w[0].p - w[1].p; if (w1 <= 0) continue;
      const w2r  = (w[2].p - w[1].p) / w1; if (w2r < 0.30 || w2r > 0.82) continue;
      const w3   = w[2].p - w[3].p; if (w3 < w1 * 0.88) continue;
      const w4r  = (w[4].p - w[3].p) / w3; if (w4r < 0.18 || w4r > 0.65) continue;
      if (w[4].p >= w[1].p) continue;
      found.push({
        pts: w.slice(0, 5),
        dir: 'dn', w1, w2r, w3ext: w3 / w1, w4r,
        labels: cfg.labels, degree: cfg.degree, origin: w[0].p, tf,
      });
    }
  }
  return found.slice(-2);
}

// ── SIGNAL SCORING (server-side, used for 24/7 alerts) ───────────
// Lógica alineada exactamente con el frontend (index.html):
//   - Score sobre 4 condiciones: FLD + Fibonacci + Pivote + Elliott
//   - VPOC se calcula y se reporta pero NO cuenta para el score
//   - Tolerancia de pivotes: ±0.5% (igual que el panel principal)
//   - Elliott cuenta si existe al menos 1 onda detectada en el TF
// Returns { signal, score, max, dir, price, entry, sl, t1, t2, vpoc, rules }
export function scoreSignal(candles, tf, TF_CONFIG) {
  if (!candles || candles.length < 60) return null;

  const price = candles[candles.length - 1].close;
  const piv   = calcPivots(candles);
  const fib   = calcFibonacci(candles);
  const vpoc  = calcVPOC(candles.slice(-100));
  const hp    = (TF_CONFIG[tf] || TF_CONFIG['1h']).hurstP;

  // ── 1. FLD direction (igual que frontend) ──────────────────────
  const fdA     = calcFLD(candles, hp[0]);
  const fdB     = calcFLD(candles, hp[1]);
  const fldAval = fdA.length ? fdA[fdA.length - 1].value : null;
  const fldBval = fdB.length ? fdB[fdB.length - 1].value : null;
  let   fldDir  = null;
  if (fldAval && fldBval) {
    const aa = price > fldAval, ab = price > fldBval;
    if (aa && ab)        fldDir = 'up';
    else if (!aa && !ab) fldDir = 'dn';
  }

  // ── 2. Fibonacci golden zone (igual que frontend) ───────────────
  const inFib = fib && price >= fib.r618 && price <= fib.r382;

  // ── 3. Pivot confluence — tolerancia ±0.5% (igual que frontend) ─
  let pvOk = false;
  if (piv) {
    for (const v of [piv.PP, piv.R1, piv.S1])
      if (Math.abs(price - v) / price < 0.005) { pvOk = true; break; }
  }

  // ── 4. Elliott Wave detectada en este TF (igual que frontend) ───
  const waves  = detectElliott(candles, tf, TF_CONFIG);
  const w1ok   = waves && waves.length > 0;

  // ── SCORE FINAL (4 condiciones, igual que frontend) ─────────────
  const rules = { fldDir, inFib, pvOk, w1ok, nearVPOC: vpoc && Math.abs(price - vpoc) / price < 0.006 };
  const score = [fldDir !== null, inFib, pvOk, w1ok].filter(Boolean).length;
  const max   = 4;
  const dir   = fldDir;

  if (score >= 3 && dir) {
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

// ── TF CONFIG (shared between server and client via window.__TFC) ─
export const TF_CONFIG = {
  '1m':  { degree: 'Sub-Minuette', labels: ['i','ii','iii','iv','v'],          hurstP: [15,30,60] },
  '5m':  { degree: 'Minuette',     labels: ['ⅰ','ⅱ','ⅲ','ⅳ','ⅴ'],          hurstP: [20,40,80] },
  '15m': { degree: 'Minute',       labels: ['①','②','③','④','⑤'],           hurstP: [20,40,80] },
  '1h':  { degree: 'Minor',        labels: ['[1]','[2]','[3]','[4]','[5]'],    hurstP: [10,20,40] },
  '4h':  { degree: 'Intermediate', labels: ['(1)','(2)','(3)','(4)','(5)'],    hurstP: [8,16,32]  },
  '1d':  { degree: 'Primary',      labels: ['I','II','III','IV','V'],           hurstP: [5,10,20]  },
};
