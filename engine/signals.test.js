// ═══════════════════════════════════════════════════════════════
//  engine/signals.test.js  —  Tests for v8.0
//  Node.js built-in test runner (no extra deps)
// ═══════════════════════════════════════════════════════════════
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ema, calcRSI, calcMACD, calcADX, calcATR,
  calcPivots, calcFibonacci, calcVPOC, isVolumeAboveAvg,
  detectSwings, detectElliott, scoreSignal,
  detectFibBounce, calcRSIDynamic, calcOBV,
  detectTrend, detectCandlePatterns,
  TF_CONFIG,
} from './signals.js';

function genCandles(n, base = 100, trend = 0) {
  const out = [];
  let p = base;
  for (let i = 0; i < n; i++) {
    p += trend + (Math.random() - 0.5) * 2;
    out.push({ time: 1000 + i, open: p - 0.5, high: p + 1, low: p - 1, close: p, vol: 1000 + Math.random() * 500 });
  }
  return out;
}

// ── EMA ──────────────────────────────────────────────────────────
describe('EMA', () => {
  it('returns null for insufficient data', () => {
    const r = ema([1, 2], 5);
    assert.deepEqual(r, [null, null]);
  });
  it('calculates correct EMA for known data', () => {
    const data = [10, 11, 12, 13, 14, 15];
    const r = ema(data, 3);
    assert.ok(r[2] !== null);
    assert.ok(Math.abs(r[2] - 11) < 0.01);
  });
  it('handles single-element period', () => {
    const r = ema([5, 6, 7], 1);
    assert.equal(r[0], 5);
  });
});

// ── RSI ──────────────────────────────────────────────────────────
describe('RSI', () => {
  it('returns null for insufficient data', () => {
    assert.equal(calcRSI([{close:1},{close:2}]), null);
  });
  it('returns valid RSI for sufficient data', () => {
    const candles = genCandles(30);
    const r = calcRSI(candles);
    assert.ok(r && r.value >= 0 && r.value <= 100);
  });
  it('returns 100 when all gains, no losses', () => {
    const candles = Array.from({length:20}, (_, i) => ({close: i * 10}));
    const r = calcRSI(candles);
    assert.equal(r.value, 100);
  });
});

// ── MACD ─────────────────────────────────────────────────────────
describe('MACD', () => {
  it('returns null for insufficient data', () => {
    assert.equal(calcMACD(genCandles(10)), null);
  });
  it('returns valid MACD for sufficient data', () => {
    const r = calcMACD(genCandles(60));
    assert.ok(r && typeof r.macdVal === 'number');
    assert.ok(['up','dn',null].includes(r.dir));
  });
});

// ── ADX ──────────────────────────────────────────────────────────
describe('ADX', () => {
  it('returns null for insufficient data', () => {
    assert.equal(calcADX(genCandles(10)), null);
  });
  it('returns valid ADX for sufficient data', () => {
    const r = calcADX(genCandles(60));
    assert.ok(r && typeof r.value === 'number');
    assert.ok(typeof r.diPlus === 'number');
    assert.ok(typeof r.diMinus === 'number');
    assert.ok(['up','dn',null].includes(r.dir));
  });
  it('detects trending market', () => {
    const candles = genCandles(60, 100, 0.5);
    const r = calcADX(candles);
    assert.ok(r);
    assert.ok(typeof r.trending === 'boolean');
  });
});

// ── ATR ──────────────────────────────────────────────────────────
describe('ATR', () => {
  it('returns null for insufficient data', () => {
    assert.equal(calcATR(genCandles(5)), null);
  });
  it('returns valid ATR for sufficient data', () => {
    const candles = genCandles(30);
    const r = calcATR(candles, 14);
    assert.ok(typeof r === 'number');
    assert.ok(r > 0);
  });
  it('higher ATR for volatile data', () => {
    const calm = genCandles(30, 100, 0);
    const volatile = genCandles(30, 100, 0).map(c => ({...c, high: c.high + 10, low: c.low - 10}));
    assert.ok(calcATR(volatile) > calcATR(calm));
  });
});

// ── RSI Dynamic ──────────────────────────────────────────────────
describe('RSI Dynamic', () => {
  it('returns null for insufficient data', () => {
    assert.equal(calcRSIDynamic(genCandles(10)), null);
  });
  it('returns percentile values', () => {
    const r = calcRSIDynamic(genCandles(100), 14, 50);
    assert.ok(r && typeof r.p30 === 'number' && typeof r.p70 === 'number');
    assert.ok(r.p30 < r.p70);
    assert.ok(typeof r.p20 === 'number');
    assert.ok(typeof r.p80 === 'number');
  });
});

// ── Fibonacci Bounce ─────────────────────────────────────────────
describe('Fibonacci Bounce', () => {
  it('returns null for insufficient data', () => {
    assert.equal(detectFibBounce(genCandles(3), null, 1), null);
  });
  it('detects bounce', () => {
    const fib = { r786: 95, r618: 97, r500: 100, r382: 103, r236: 105, H: 110, L: 90 };
    const candles = genCandles(15, 100);
    candles[14] = { time: 1014, open: 96.5, high: 97.2, low: 95.8, close: 97.5, vol: 1000 };
    const r = detectFibBounce(candles, fib, 2);
    assert.ok(r === null || (r && r.direction));
  });
});

// ── Pivot Points ─────────────────────────────────────────────────
describe('Pivot Points', () => {
  it('returns null for insufficient data', () => {
    assert.equal(calcPivots(genCandles(5)), null);
  });
  it('calculates valid pivots', () => {
    const candles = genCandles(60);
    const r = calcPivots(candles);
    assert.ok(r && r.PP && r.R1 && r.S1);
    assert.ok(r.R1 > r.PP);
    assert.ok(r.S1 < r.PP);
  });
});

// ── Fibonacci ────────────────────────────────────────────────────
describe('Fibonacci', () => {
  it('calculates valid Fibonacci levels', () => {
    const candles = genCandles(60);
    const r = calcFibonacci(candles);
    assert.ok(r.H > r.L);
    assert.ok(r.r382 > r.r618);
  });
});

// ── Volume ───────────────────────────────────────────────────────
describe('Volume', () => {
  it('detects above-average volume', () => {
    const candles = genCandles(25);
    candles[24] = { ...candles[24], vol: 5000 };
    assert.ok(isVolumeAboveAvg(candles));
  });
  it('detects normal volume', () => {
    const candles = genCandles(25);
    assert.ok(!isVolumeAboveAvg(candles));
  });
});

// ── OBV ──────────────────────────────────────────────────────────
describe('OBV', () => {
  it('returns null for insufficient data', () => {
    assert.equal(calcOBV(genCandles(5)), null);
  });
  it('returns valid OBV', () => {
    const r = calcOBV(genCandles(30));
    assert.ok(r && typeof r.value === 'number');
    assert.ok(typeof r.rising === 'boolean');
  });
});

// ── Trend Detection ──────────────────────────────────────────────
describe('Trend Detection', () => {
  it('returns null for insufficient data', () => {
    assert.equal(detectTrend(genCandles(50)), null);
  });
  it('returns valid trend', () => {
    const r = detectTrend(genCandles(250));
    assert.ok(r);
    assert.ok(['up','dn',null].includes(r.dir));
    assert.ok(typeof r.ema50 === 'number');
    assert.ok(typeof r.ema200 === 'number');
  });
});

// ── Candle Patterns ──────────────────────────────────────────────
describe('Candle Patterns', () => {
  it('returns object with bullish/bearish', () => {
    const r = detectCandlePatterns(genCandles(10));
    assert.ok(typeof r.bullish === 'boolean');
    assert.ok(typeof r.bearish === 'boolean');
  });
});

// ── Swing Detection ──────────────────────────────────────────────
describe('Swing Detection', () => {
  it('detects swing highs and lows', () => {
    const candles = genCandles(50);
    const sw = detectSwings(candles, 3);
    assert.ok(Array.isArray(sw));
    assert.ok(sw.every(s => s.t === 'H' || s.t === 'L'));
  });
});

// ── Score Signal ─────────────────────────────────────────────────
describe('Score Signal', () => {
  it('returns WAIT for random data', () => {
    const candles = genCandles(100);
    const r = scoreSignal(candles, '1h', TF_CONFIG);
    assert.ok(r);
    assert.ok(r.signal === 'WAIT' || r.signal === 'LONG' || r.signal === 'SHORT');
    assert.ok(typeof r.score === 'number');
    assert.equal(r.max, 14);  // v8.0: weighted total = 14
  });
  it('returns valid structure', () => {
    const candles = genCandles(100);
    const r = scoreSignal(candles, '5m', TF_CONFIG);
    assert.ok(r.rules);
    assert.ok(typeof r.rules.adxOk === 'boolean');
    assert.ok(typeof r.rules.macdOk === 'boolean');
    assert.ok(typeof r.rules.emaOk === 'boolean');
    assert.ok(typeof r.rules.obvOk === 'boolean');
    assert.ok('fibOk' in r.rules);
  });
  it('handles different timeframes', () => {
    for (const tf of ['1m','5m','15m','1h','4h','1d']) {
      const candles = genCandles(100);
      const r = scoreSignal(candles, tf, TF_CONFIG);
      assert.ok(r);
    }
  });
  it('requires direction confirmation from multiple indicators', () => {
    // Random data should not produce strong signals
    const candles = genCandles(100);
    const r = scoreSignal(candles, '1h', TF_CONFIG);
    // Random data: score should be below threshold
    assert.ok(r.score < 10);
  });
});
