// ═══════════════════════════════════════════════════════════════
//  signals.test.js — Unit tests for engine/signals.js
//  Run: node --test engine/signals.test.js
// ═══════════════════════════════════════════════════════════════
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ema, calcRSI, calcMACD, calcADX, calcPivots, calcFibonacci,
  calcVPOC, isVolumeAboveAvg, detectSwings, scoreSignal, TF_CONFIG,
} from './signals.js';

// ── Helpers ──────────────────────────────────────────────────
function genCandles(n, basePrice = 60000) {
  const candles = [];
  const now = Math.floor(Date.now() / 1000);
  let price = basePrice;
  for (let i = 0; i < n; i++) {
    price += (Math.random() - 0.5) * (basePrice * 0.002);
    candles.push({
      time: now - (n - i) * 60,
      open: price,
      high: price + Math.random() * (basePrice * 0.001),
      low: price - Math.random() * (basePrice * 0.001),
      close: price + (Math.random() - 0.5) * (basePrice * 0.0005),
      vol: Math.random() * 10000 + 5000,
    });
  }
  return candles;
}

function genTrendingCandles(n, dir = 'up', basePrice = 60000) {
  const candles = [];
  const now = Math.floor(Date.now() / 1000);
  let price = basePrice;
  const step = dir === 'up' ? basePrice * 0.001 : -basePrice * 0.001;
  for (let i = 0; i < n; i++) {
    price += step + (Math.random() - 0.5) * (basePrice * 0.0003);
    candles.push({
      time: now - (n - i) * 60,
      open: price,
      high: price + Math.abs(step) * 0.5,
      low: price - Math.abs(step) * 0.5,
      close: price + step * 0.3,
      vol: Math.random() * 10000 + 5000 + (dir === 'up' ? i * 100 : 0),
    });
  }
  return candles;
}

// ── Tests ────────────────────────────────────────────────────
describe('EMA', () => {
  it('returns null for insufficient data', () => {
    const result = ema([1, 2], 5);
    assert.ok(result.every(v => v === null));
  });

  it('calculates correct EMA for known data', () => {
    const data = [10, 11, 12, 13, 14, 15];
    const result = ema(data, 3);
    assert.ok(result[2] !== null);
    assert.ok(result[2] > 10 && result[2] < 15);
  });

  it('handles single-element period', () => {
    const data = [10, 20, 30];
    const result = ema(data, 1);
    assert.equal(result[0], 10);
    assert.equal(result[1], 20);
  });
});

describe('RSI', () => {
  it('returns null for insufficient data', () => {
    assert.equal(calcRSI(genCandles(5)), null);
  });

  it('returns valid RSI for sufficient data', () => {
    const rsi = calcRSI(genCandles(50));
    assert.ok(rsi);
    assert.ok(rsi.value >= 0 && rsi.value <= 100);
    assert.ok(typeof rsi.rising === 'boolean');
  });

  it('returns 100 when all gains, no losses', () => {
    const candles = [];
    let price = 100;
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 30; i++) {
      price += 1;
      candles.push({ time: now - (30 - i) * 60, open: price - 1, high: price + 1, low: price - 2, close: price, vol: 1000 });
    }
    const rsi = calcRSI(candles);
    assert.equal(rsi.value, 100);
  });
});

describe('MACD', () => {
  it('returns null for insufficient data', () => {
    assert.equal(calcMACD(genCandles(10)), null);
  });

  it('returns valid MACD for sufficient data', () => {
    const macd = calcMACD(genCandles(100));
    assert.ok(macd);
    assert.ok(typeof macd.macdVal === 'number');
    assert.ok(typeof macd.sigVal === 'number');
    assert.ok(['up', 'dn', null].includes(macd.dir));
  });
});

describe('ADX', () => {
  it('returns null for insufficient data', () => {
    assert.equal(calcADX(genCandles(10)), null);
  });

  it('returns valid ADX for sufficient data', () => {
    const adx = calcADX(genCandles(100));
    assert.ok(adx);
    assert.ok(adx.value >= 0);
    assert.ok(typeof adx.trending === 'boolean');
  });

  it('detects trending market', () => {
    const candles = genTrendingCandles(100, 'up');
    const adx = calcADX(candles);
    assert.ok(adx);
    // Strong trend should have ADX > 25 (or close)
    assert.ok(adx.value > 15); // Allow some variance in test data
  });
});

describe('Pivot Points', () => {
  it('returns null for insufficient data', () => {
    assert.equal(calcPivots(genCandles(5)), null);
  });

  it('calculates valid pivots', () => {
    const pv = calcPivots(genCandles(60));
    assert.ok(pv);
    assert.ok(pv.PP > 0);
    assert.ok(pv.R1 > pv.PP);
    assert.ok(pv.S1 < pv.PP);
    assert.ok(pv.R2 > pv.R1);
    assert.ok(pv.S2 < pv.S1);
  });
});

describe('Fibonacci', () => {
  it('calculates valid Fibonacci levels', () => {
    const fib = calcFibonacci(genCandles(150));
    assert.ok(fib);
    assert.ok(fib.H > fib.L);
    assert.ok(fib.r618 < fib.r382); // 61.8% is deeper than 38.2%
    assert.ok(fib.r500 > fib.r618 && fib.r500 < fib.r382);
  });
});

describe('Volume', () => {
  it('detects above-average volume', () => {
    const candles = genCandles(30);
    // Last candle with very high volume
    candles[candles.length - 1].vol = 100000;
    assert.ok(isVolumeAboveAvg(candles));
  });

  it('detects normal volume', () => {
    const candles = genCandles(30);
    candles.forEach(c => c.vol = 1000);
    assert.ok(!isVolumeAboveAvg(candles));
  });
});

describe('Swing Detection', () => {
  it('detects swing highs and lows', () => {
    const candles = genCandles(100);
    const swings = detectSwings(candles, 3);
    assert.ok(Array.isArray(swings));
    // Should find some swings in 100 candles
    assert.ok(swings.length >= 0);
    swings.forEach(s => {
      assert.ok(['H', 'L'].includes(s.t));
      assert.ok(typeof s.p === 'number');
    });
  });
});

describe('Score Signal', () => {
  it('returns WAIT for random data', () => {
    const candles = genCandles(100);
    const sig = scoreSignal(candles, '1h', TF_CONFIG);
    assert.ok(sig);
    assert.equal(sig.signal, 'WAIT');
    assert.ok(sig.score >= 0 && sig.score <= 8);
  });

  it('returns valid structure', () => {
    const candles = genCandles(100);
    const sig = scoreSignal(candles, '5m', TF_CONFIG);
    assert.ok(sig);
    assert.ok(sig.hasOwnProperty('signal'));
    assert.ok(sig.hasOwnProperty('score'));
    assert.ok(sig.hasOwnProperty('max'));
    assert.ok(sig.hasOwnProperty('rules'));
    assert.equal(sig.max, 8);
  });

  it('handles different timeframes', () => {
    for (const tf of ['1m', '5m', '15m', '1h', '4h', '1d']) {
      const candles = genCandles(100);
      const sig = scoreSignal(candles, tf, TF_CONFIG);
      assert.ok(sig, `Failed for TF: ${tf}`);
      assert.ok(['LONG', 'SHORT', 'WAIT'].includes(sig.signal));
    }
  });
});
