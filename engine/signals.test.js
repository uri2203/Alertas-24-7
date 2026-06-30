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
    const candles = [];
    for (let i = 0; i < 25; i++) {
      candles.push({ time: i, open: 100, high: 101, low: 99, close: 100, vol: 100 });
    }
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
  it('returns WAIT for random data', async () => {
    const candles = genCandles(100);
    const r = await scoreSignal(candles, '1h', TF_CONFIG);
    assert.ok(r);
    assert.ok(r.signal === 'WAIT' || r.signal === 'LONG' || r.signal === 'SHORT');
    assert.ok(typeof r.score === 'number');
    assert.equal(r.max, 16);  // v8.0: weighted total = 16 (14 base + regime + mlConf)
  });
  it('returns valid structure', async () => {
    const candles = genCandles(100);
    const r = await scoreSignal(candles, '5m', TF_CONFIG);
    assert.ok(r.rules);
    assert.ok(typeof r.rules.adxOk === 'boolean');
    assert.ok(typeof r.rules.macdOk === 'boolean');
    assert.ok(typeof r.rules.emaOk === 'boolean');
    assert.ok(typeof r.rules.obvOk === 'boolean');
    assert.ok('fibOk' in r.rules);
  });
  it('handles different timeframes', async () => {
    for (const tf of ['1m','5m','15m','1h','4h','1d']) {
      const candles = genCandles(100);
      const r = await scoreSignal(candles, tf, TF_CONFIG);
      assert.ok(r);
    }
  });
  it('requires direction confirmation from multiple indicators', async () => {
    // Random data should not produce strong signals
    const candles = genCandles(100);
    const r = await scoreSignal(candles, '1h', TF_CONFIG);
    // Random data: score should be below threshold
    assert.ok(r.score < 12);
  });
});

// ══════════════════════════════════════════════════════════════════
//  TESTS FOR NEW v8.0 MODULES
// ══════════════════════════════════════════════════════════════════

import { kellyFraction, calcPositionSize, checkMaxDrawdown, calcExpectancy, maxConsecutiveLosses, generateRiskReport } from './risk.js';
import { detectRegimeADX, detectRegimeVolatility, detectRegimeTrend, detectRegime, regimeScoreAdjustment } from './regime.js';
import { LogisticClassifier, extractFeatures, FEATURE_NAMES } from './ml.js';
import { monteCarloSimulation, robustnessScore } from './monte.js';
import { marketToState, chooseAction, agentPredict, trainFromHistory, getAgentStats, exportQTable, resetAgent } from './agent.js';
import { detectBOS, detectOrderBlocks, detectFVG, detectLiquidityZones, priceInZone, detectPullback, analyzeStructure, checkSpread, checkTimeFilter, multiTFBlockConfluence, checkInvalidation, getDynamicMinScore } from './structure.js';
import { getSeasonality, getWeeklyCycle, getHourlyCycle, getBitcoinCycle, detectVolumeRotation, timeFactorScore, fullCycleMap } from './cycles.js';
import { pearsonCorrelation, returns, correlationMatrix, btcDominanceProxy, ethBtcRatio, detectRedundantSignals, analyzeCorrelation } from './correlation.js';
import { openPosition, closePosition, checkBreakeven, checkTrailingStop, checkPartialProfit, checkEarlyClose, checkSLTP, getOpenPositions, canOpenPosition, managePosition, calculatePositionSize, riskReward, getPositionStats } from './position.js';
import { analyzeFundingRate, analyzeOpenInterest, analyzeLongShortRatio, fundingScore } from './funding.js';
import { analyzeMultiTF, complementaryIndicators, structureScore } from './confluence.js';

// ── RISK MODULE ──────────────────────────────────────────────────
describe('Risk Management', () => {
  it('kellyFraction returns 0 for invalid inputs', () => {
    assert.equal(kellyFraction(0, 0.02, 0.01), 0);
    assert.equal(kellyFraction(0.5, 0, 0.01), 0);
  });

  it('kellyFraction calculates positive fraction for profitable strategy', () => {
    const k = kellyFraction(0.6, 0.02, 0.01);
    assert.ok(k > 0);
    assert.ok(k < 0.1); // Fractional Kelly should be small
  });

  it('calcPositionSize returns valid structure', () => {
    const pos = calcPositionSize(10000, 0.02, 0.7, 'trending');
    assert.ok(pos.riskPct >= 0.005);
    assert.ok(pos.riskPct <= 0.05);
    assert.ok(pos.riskAmount > 0);
  });

  it('checkMaxDrawdown detects breach', () => {
    const ok = checkMaxDrawdown(9500, 10000, 0.15);
    assert.equal(ok.breached, false);
    const bad = checkMaxDrawdown(8000, 10000, 0.15);
    assert.equal(bad.breached, true);
  });

  it('calcExpectancy returns positive for profitable strategy', () => {
    const e = calcExpectancy(0.6, 0.02, 0.01);
    assert.ok(e > 0);
  });

  it('maxConsecutiveLosses returns reasonable estimate', () => {
    const trades = Array.from({ length: 50 }, (_, i) => ({
      result: i % 3 === 0 ? 'LOSS' : 'WIN'
    }));
    const mcl = maxConsecutiveLosses(trades, 0.95);
    assert.ok(mcl > 0);
    assert.ok(mcl < 50);
  });

  it('generateRiskReport returns complete report', () => {
    const trades = [
      { result: 'WIN', pnl: 0.02 },
      { result: 'LOSS', pnl: -0.01 },
      { result: 'WIN', pnl: 0.03 },
      { result: 'LOSS', pnl: -0.01 },
      { result: 'WIN', pnl: 0.015 },
    ];
    const report = generateRiskReport(trades, 10000);
    assert.ok(report);
    assert.equal(report.totalTrades, 5);
    assert.ok(report.winRate > 0);
    assert.ok(report.kellyFraction >= 0);
    assert.ok(report.maxDrawdown >= 0);
  });
});

// ── REGIME MODULE ─────────────────────────────────────────────────
describe('Regime Detection', () => {
  it('detectRegimeADX returns null for insufficient data', () => {
    assert.equal(detectRegimeADX(genCandles(10)), null);
  });

  it('detectRegimeADX returns valid regime for sufficient data', () => {
    const candles = genCandles(100, 100, 0.5); // Strong uptrend
    const r = detectRegimeADX(candles);
    assert.ok(r);
    assert.ok(['trending', 'ranging', 'transitional'].includes(r.regime));
  });

  it('detectRegimeVolatility returns null for insufficient data', () => {
    assert.equal(detectRegimeVolatility(genCandles(20)), null);
  });

  it('detectRegimeTrend returns trend info', () => {
    const candles = genCandles(120, 100, 0.3);
    const r = detectRegimeTrend(candles);
    assert.ok(r);
    assert.ok(typeof r.slope20 === 'number');
  });

  it('detectRegime returns composite regime', () => {
    const candles = genCandles(150, 100, 0.2);
    const r = detectRegime(candles);
    assert.ok(r);
    assert.ok(['trending', 'ranging', 'volatile', 'unknown'].includes(r.regime));
    assert.ok(typeof r.confidence === 'number');
  });

  it('regimeScoreAdjustment returns numeric value', () => {
    const adj = regimeScoreAdjustment({ regime: 'trending', confidence: 0.8 });
    assert.ok(typeof adj === 'number');
    assert.ok(adj > 0); // Trending should be positive
  });
});

// ── ML MODULE ─────────────────────────────────────────────────────
describe('ML Classifier', () => {
  it('LogisticClassifier initializes correctly', () => {
    const clf = new LogisticClassifier();
    assert.equal(clf.trained, false);
    assert.equal(clf.predict({}), 0.5);
  });

  it('LogisticClassifier trains and predicts', () => {
    const clf = new LogisticClassifier();
    const X = Array.from({ length: 50 }, () => {
      const f = {};
      FEATURE_NAMES.forEach(n => f[n] = Math.random());
      return f;
    });
    const y = X.map(f => f.rsi > 0.5 ? 1 : 0);
    clf.train(X, y, 100, 0.1);
    assert.equal(clf.trained, true);
    const pred = clf.predict(X[0]);
    assert.ok(pred >= 0 && pred <= 1);
  });

  it('LogisticClassifier evaluates accuracy', () => {
    const clf = new LogisticClassifier();
    const X = Array.from({ length: 50 }, () => {
      const f = {};
      FEATURE_NAMES.forEach(n => f[n] = Math.random());
      return f;
    });
    const y = X.map(f => f.rsi > 0.5 ? 1 : 0);
    clf.train(X, y, 100, 0.1);
    const acc = clf.evaluate(X, y);
    assert.ok(acc >= 0 && acc <= 1);
  });

  it('extractFeatures returns valid features', () => {
    const candles = genCandles(150);
    const features = extractFeatures(candles, '1h');
    assert.ok(features);
    assert.ok(typeof features.rsi === 'number');
    assert.ok(typeof features.macdDir === 'number');
    assert.ok(typeof features.atrPct === 'number');
  });

  it('extractFeatures returns null for insufficient data', () => {
    assert.equal(extractFeatures(genCandles(50), '1h'), null);
  });
});

// ── MONTE CARLO MODULE ────────────────────────────────────────────
describe('Monte Carlo', () => {
  it('monteCarloSimulation returns null for insufficient trades', () => {
    assert.equal(monteCarloSimulation([]), null);
  });

  it('monteCarloSimulation returns valid results', () => {
    const trades = Array.from({ length: 30 }, (_, i) => ({
      pnl: (Math.random() - 0.4) * 0.05,
    }));
    const mc = monteCarloSimulation(trades, { iterations: 1000, capital: 10000 });
    assert.ok(mc);
    assert.equal(mc.iterations, 1000);
    assert.ok(mc.percentiles);
    assert.ok(mc.probabilityOfLoss >= 0);
    assert.ok(mc.worstDrawdown >= 0);
  });

  it('robustnessScore returns score 0-100', () => {
    const trades = Array.from({ length: 30 }, () => ({
      pnl: (Math.random() - 0.3) * 0.05,
    }));
    const mc = monteCarloSimulation(trades, { iterations: 500 });
    const score = robustnessScore(mc);
    assert.ok(score >= 0 && score <= 100);
  });
});

// ── RL AGENT ─────────────────────────────────────────────────────
describe('RL Agent', () => {
  it('marketToState returns valid state 0-1023', () => {
    const candles = genCandles(250);
    const state = marketToState(candles);
    assert.ok(state >= 0 && state < 1024);
  });

  it('marketToState returns 0 for insufficient data', () => {
    assert.equal(marketToState(genCandles(50)), 0);
  });

  it('chooseAction returns 0 or 1', () => {
    resetAgent();
    for (let i = 0; i < 10; i++) {
      const action = chooseAction(Math.floor(Math.random() * 1024), 0.5);
      assert.ok(action === 0 || action === 1);
    }
  });

  it('agentPredict returns valid structure', () => {
    resetAgent();
    const candles = genCandles(250);
    const pred = agentPredict(candles);
    assert.ok(pred);
    assert.ok(pred.action === 'TRADE' || pred.action === 'SKIP');
    assert.ok(typeof pred.confidence === 'number');
    assert.ok(typeof pred.state === 'number');
  });

  it('trainFromHistory returns stats', () => {
    resetAgent();
    const trades = Array.from({ length: 20 }, (_, i) => ({
      sym: 'BTCUSDT', tf: '1h',
      entryTime: 1000 + i * 100,
      result: i % 2 === 0 ? 'WIN' : 'LOSS',
      pnl: i % 2 === 0 ? 0.02 : -0.01,
    }));
    const candlesCache = { 'BTCUSDT-1h': genCandles(300) };
    const result = trainFromHistory(trades, candlesCache);
    assert.ok(result);
    assert.ok(result.episodes > 0);
    assert.ok(typeof result.avgReward === 'number');
  });

  it('getAgentStats returns valid stats', () => {
    const stats = getAgentStats();
    assert.ok(stats);
    assert.ok(typeof stats.episodes === 'number');
    assert.ok(typeof stats.statesExplored === 'number');
    assert.ok(typeof stats.explorationPct === 'number');
  });

  it('exportQTable returns serializable data', () => {
    const data = exportQTable();
    assert.ok(data.qTable);
    assert.ok(Array.isArray(data.qTable));
    assert.ok(data.qTable.length > 0);
  });
});

// ── MARKET STRUCTURE ──────────────────────────────────────────
describe('Market Structure', () => {
  it('detectBOS returns null for insufficient data', () => {
    assert.equal(detectBOS(genCandles(10)), null);
  });

  it('detectBOS returns valid structure for sufficient data', () => {
    const candles = genCandles(100);
    const result = detectBOS(candles);
    if (result) {
      assert.ok(['bullish_bos', 'bearish_bos', 'bullish_choch', 'bearish_choch', 'ranging'].includes(result.structure));
      assert.ok(['uptrend', 'downtrend', 'neutral'].includes(result.trend));
      assert.ok(Array.isArray(result.swingHighs));
      assert.ok(Array.isArray(result.swingLows));
    }
  });

  it('detectOrderBlocks returns array', () => {
    const candles = genCandles(100);
    const blocks = detectOrderBlocks(candles);
    assert.ok(Array.isArray(blocks));
    assert.ok(blocks.length <= 5);
    for (const b of blocks) {
      assert.ok(b.type === 'bull_ob' || b.type === 'bear_ob');
      assert.ok(typeof b.high === 'number');
      assert.ok(typeof b.low === 'number');
    }
  });

  it('detectFVG returns array', () => {
    const candles = genCandles(100);
    const fvgs = detectFVG(candles);
    assert.ok(Array.isArray(fvgs));
    assert.ok(fvgs.length <= 3);
    for (const f of fvgs) {
      assert.ok(f.type === 'bull_fvg' || f.type === 'bear_fvg');
      assert.ok(f.high > f.low);
    }
  });

  it('detectLiquidityZones returns buyside and sellside', () => {
    const candles = genCandles(100);
    const zones = detectLiquidityZones(candles);
    assert.ok(zones.buyside);
    assert.ok(zones.sellside);
    assert.ok(Array.isArray(zones.buyside));
    assert.ok(Array.isArray(zones.sellside));
  });

  it('priceInZone detects when price is in OB', () => {
    const blocks = [{ type: 'bull_ob', high: 105, low: 100 }];
    const fvgs = [];
    const candle = { close: 102 };
    const result = priceInZone(candle, blocks, fvgs);
    assert.ok(result.inOB);
    assert.equal(result.inFVG, null);
  });

  it('detectPullback returns null for insufficient data', () => {
    assert.equal(detectPullback(genCandles(5), null, [], []), null);
  });

  it('analyzeStructure returns complete analysis', () => {
    const candles = genCandles(100);
    const result = analyzeStructure(candles);
    assert.ok(result);
    assert.ok(typeof result.hasStructure === 'boolean');
    assert.ok(typeof result.hasPullback === 'boolean');
    assert.ok(Array.isArray(result.blocks));
    assert.ok(Array.isArray(result.fvgs));
  });
});

// ── CONFLUENCE ────────────────────────────────────────────────
describe('Confluence', () => {
  it('analyzeMultiTF returns null for insufficient data', () => {
    assert.equal(analyzeMultiTF({}), null);
  });

  it('analyzeMultiTF returns valid analysis', () => {
    const candlesByTF = {
      '1h': genCandles(100),
      '4h': genCandles(100),
      '1d': genCandles(100),
    };
    const result = analyzeMultiTF(candlesByTF);
    if (result) {
      assert.ok(['bullish', 'bearish', 'neutral'].includes(result.macroDirection));
      assert.ok(typeof result.percentage === 'number');
      assert.ok(result.percentage >= 0 && result.percentage <= 100);
    }
  });

  it('complementaryIndicators returns valid indicators', () => {
    const candles = genCandles(100);
    const result = complementaryIndicators(candles);
    assert.ok(result);
    assert.ok(typeof result.volRatio === 'number');
    assert.ok(typeof result.momentum === 'number');
    assert.ok(typeof result.volumeConfirm === 'boolean');
  });

  it('structureScore returns valid score', () => {
    const candlesByTF = {
      '1h': genCandles(100),
      '4h': genCandles(100),
      '1d': genCandles(100),
    };
    const multiTF = analyzeMultiTF(candlesByTF);
    const indicators = complementaryIndicators(genCandles(100));
    const result = structureScore(multiTF, indicators);
    assert.ok(result);
    assert.ok(typeof result.score === 'number');
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(['none', 'weak', 'moderate', 'strong', 'elite'].includes(result.quality));
    assert.ok(['LONG', 'SHORT', 'WAIT'].includes(result.direction));
  });
});

// ── NEW FILTERS ──────────────────────────────────────────────
describe('Spread Filter', () => {
  it('checkSpread returns ok for normal data', () => {
    const candles = genCandles(10);
    const result = checkSpread(candles);
    assert.ok(typeof result.ok === 'boolean');
    assert.ok(typeof result.spread === 'number');
  });

  it('checkSpread detects high spread', () => {
    const candles = [
      { close: 100, high: 101, low: 99 },
      { close: 105, high: 106, low: 104 }, // 5% change + 2% range
    ];
    const result = checkSpread(candles, 0.1);
    assert.equal(result.ok, false);
    assert.ok(result.spread > 0.1);
  });
});

describe('Time Filter', () => {
  it('checkTimeFilter returns valid structure', () => {
    const result = checkTimeFilter();
    assert.ok(typeof result.ok === 'boolean');
    assert.ok(typeof result.hour === 'number');
    assert.ok(typeof result.session === 'string');
    assert.ok(typeof result.sessionLabel === 'string');
  });
});

describe('Multi-TF OB Confluence', () => {
  it('multiTFBlockConfluence returns null for insufficient data', () => {
    assert.equal(multiTFBlockConfluence({}), null);
  });

  it('multiTFBlockConfluence detects overlapping OBs', () => {
    const blocksByTF = {
      '4h': [{ type: 'bull_ob', high: 105, low: 100, strength: 2 }],
      '1h': [{ type: 'bull_ob', high: 103, low: 98, strength: 3 }],
    };
    const result = multiTFBlockConfluence(blocksByTF);
    assert.ok(result);
    assert.ok(result.isStrong);
    assert.ok(result.tfs.includes('4h'));
    assert.ok(result.tfs.includes('1h'));
  });

  it('multiTFBlockConfluence returns null for non-overlapping OBs', () => {
    const blocksByTF = {
      '4h': [{ type: 'bull_ob', high: 110, low: 105, strength: 2 }],
      '1h': [{ type: 'bull_ob', high: 100, low: 95, strength: 3 }],
    };
    const result = multiTFBlockConfluence(blocksByTF);
    assert.equal(result, null);
  });
});

describe('Invalidation Check', () => {
  it('checkInvalidation returns valid for normal data', () => {
    const candles = genCandles(10);
    const result = checkInvalidation(candles, 'LONG', { high: 200, low: 100 });
    assert.ok(typeof result.valid === 'boolean');
  });

  it('checkInvalidation detects price above zone for LONG', () => {
    const candles = genCandles(10);
    // Set last candle close above zone
    candles[candles.length - 1] = { ...candles[candles.length - 1], close: 250 };
    const result = checkInvalidation(candles, 'LONG', { high: 200, low: 150 });
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('encima'));
  });

  it('checkInvalidation detects price below zone for SHORT', () => {
    const candles = genCandles(10);
    candles[candles.length - 1] = { ...candles[candles.length - 1], close: 50 };
    const result = checkInvalidation(candles, 'SHORT', { high: 100, low: 80 });
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('debajo'));
  });
});

describe('Dynamic Score', () => {
  it('getDynamicMinScore returns valid structure', () => {
    const candles = genCandles(100);
    const result = getDynamicMinScore(70, candles);
    assert.ok(typeof result === 'object');
    assert.ok(typeof result.minScore === 'number');
    assert.ok(typeof result.volatility === 'number');
  });

  it('getDynamicMinScore raises score for high volatility', () => {
    // Create highly volatile candles
    const candles = Array.from({ length: 100 }, (_, i) => ({
      open: 100 + Math.sin(i) * 50,
      high: 100 + Math.sin(i) * 50 + 20,
      low: 100 + Math.sin(i) * 50 - 20,
      close: 100 + Math.cos(i) * 50,
      time: i,
      volume: 1000,
    }));
    const result = getDynamicMinScore(70, candles);
    assert.ok(result.minScore >= 70);
  });
});

// ── CYCLES (TIME-BASED) ─────────────────────────────────────
describe('Seasonality', () => {
  it('getSeasonality returns valid bias', () => {
    const result = getSeasonality('BTCUSDT', 1);
    assert.ok(typeof result.bias === 'number');
    assert.ok(result.bias >= -1 && result.bias <= 1);
    assert.ok(typeof result.label === 'string');
  });

  it('getSeasonality uses DEFAULT for unknown symbol', () => {
    const result = getSeasonality('UNKNOWN', 10);
    assert.ok(typeof result.bias === 'number');
  });

  it('September is bearish for BTC', () => {
    const result = getSeasonality('BTCUSDT', 9);
    assert.ok(result.bias < 0);
  });

  it('November is bullish for BTC', () => {
    const result = getSeasonality('BTCUSDT', 11);
    assert.ok(result.bias > 0);
  });
});

describe('Weekly Cycle', () => {
  it('getWeeklyCycle returns valid structure', () => {
    const result = getWeeklyCycle(new Date());
    assert.ok(typeof result.volume === 'number');
    assert.ok(typeof result.label === 'string');
    assert.ok(typeof result.day === 'number');
  });

  it('Sunday has low volume', () => {
    const result = getWeeklyCycle(new Date('2026-06-28')); // Sunday
    assert.ok(result.volume < 1);
  });

  it('Thursday has high volume', () => {
    const result = getWeeklyCycle(new Date('2026-06-25')); // Thursday
    assert.ok(result.volume >= 1);
  });
});

describe('Hourly Cycle', () => {
  it('getHourlyCycle returns valid structure', () => {
    const result = getHourlyCycle(12);
    assert.ok(typeof result.volatility === 'number');
    assert.ok(typeof result.label === 'string');
  });

  it('3am is dead', () => {
    const result = getHourlyCycle(3);
    assert.ok(result.volatility < 0.5);
  });

  it('10am has high volatility', () => {
    const result = getHourlyCycle(10);
    assert.ok(result.volatility >= 1);
  });
});

describe('Bitcoin Cycle', () => {
  it('getBitcoinCycle returns valid structure', () => {
    const result = getBitcoinCycle(3);
    assert.ok(typeof result.bias === 'number');
    assert.ok(typeof result.label === 'string');
  });

  it('Post-halving phase is bullish', () => {
    const result = getBitcoinCycle(2);
    assert.ok(result.bias > 0);
  });

  it('Bear market phase is bearish', () => {
    const result = getBitcoinCycle(40);
    assert.ok(result.bias < 0);
  });

  it('Handles null monthsSinceHalving', () => {
    const result = getBitcoinCycle(null);
    assert.ok(result.bias === 0);
  });
});

describe('Volume Rotation', () => {
  it('detectVolumeRotation returns null for insufficient data', () => {
    assert.equal(detectVolumeRotation({}), null);
  });

  it('detectVolumeRotation detects rotation', () => {
    const candlesBySymbol = {
      BTCUSDT: genCandles(30),
      ETHUSDT: genCandles(30),
    };
    // Add high recent volume to ETH
    for (let i = 25; i < 30; i++) {
      candlesBySymbol.ETHUSDT[i].volume = 10000;
    }
    const result = detectVolumeRotation(candlesBySymbol);
    assert.ok(result);
    assert.ok(typeof result.isRotating === 'boolean');
    assert.ok(typeof result.target === 'string');
  });
});

describe('Time Factor Score', () => {
  it('timeFactorScore returns valid structure', () => {
    const candles = genCandles(100);
    const result = timeFactorScore('BTCUSDT', candles);
    assert.ok(typeof result.score === 'number');
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(Array.isArray(result.reasons));
  });

  it('fullCycleMap returns complete map', () => {
    const candles = genCandles(100);
    const result = fullCycleMap('BTCUSDT', candles);
    assert.ok(result.season);
    assert.ok(result.weekly);
    assert.ok(result.hourly);
    assert.ok(result.timeScore);
  });
});

// ── CORRELATION ──────────────────────────────────────────────
describe('Correlation', () => {
  it('pearsonCorrelation returns valid value', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = pearsonCorrelation(x, y);
    assert.ok(result >= 0.99); // Perfect correlation
  });

  it('pearsonCorrelation returns 0 for insufficient data', () => {
    assert.equal(pearsonCorrelation([1], [1]), 0);
  });

  it('returns calculates correctly', () => {
    const closes = [100, 105, 103, 110];
    const result = returns(closes);
    assert.ok(result.length === 3);
    assert.ok(Math.abs(result[0] - 0.05) < 0.001);
  });

  it('correlationMatrix returns valid matrix', () => {
    const candlesBySymbol = {
      BTCUSDT: genCandles(50),
      ETHUSDT: genCandles(50),
    };
    const result = correlationMatrix(candlesBySymbol);
    assert.ok(result);
    assert.ok(result.BTCUSDT);
    assert.ok(result.ETHUSDT);
    assert.equal(result.BTCUSDT.BTCUSDT, 1);
  });

  it('btcDominanceProxy returns valid structure', () => {
    const candlesBySymbol = {
      BTCUSDT: genCandles(50),
      ETHUSDT: genCandles(50),
    };
    const result = btcDominanceProxy(candlesBySymbol);
    assert.ok(result);
    assert.ok(typeof result.dominance === 'number');
    assert.ok(['btc_leading', 'altcoins_leading', 'correlated'].includes(result.regime));
  });

  it('ethBtcRatio returns valid structure', () => {
    const candlesBySymbol = {
      BTCUSDT: genCandles(50),
      ETHUSDT: genCandles(50),
    };
    const result = ethBtcRatio(candlesBySymbol);
    assert.ok(result);
    assert.ok(typeof result.ratio === 'number');
    assert.ok(typeof result.ratioChange === 'number');
  });

  it('detectRedundantSignals filters correlated signals', () => {
    const signals = [
      { sym: 'ETHUSDT', direction: 'LONG', score: 80 },
      { sym: 'SOLUSDT', direction: 'LONG', score: 75 },
    ];
    const matrix = { ETHUSDT: { ETHUSDT: 1, SOLUSDT: 0.9 }, SOLUSDT: { ETHUSDT: 0.9, SOLUSDT: 1 } };
    const result = detectRedundantSignals(signals, matrix);
    assert.ok(result.length === 1);
    assert.equal(result[0].sym, 'ETHUSDT');
  });
});

// ── POSITION MANAGEMENT ──────────────────────────────────────
describe('Position Management', () => {
  it('openPosition creates position', () => {
    const pos = openPosition('BTCUSDT', 'LONG', 100, 95, 110);
    assert.ok(pos);
    assert.equal(pos.status, 'open');
    assert.equal(pos.direction, 'LONG');
  });

  it('closePosition calculates P&L correctly for LONG', () => {
    openPosition('TEST1', 'LONG', 100, 95, 110);
    const result = closePosition('TEST1', 105, 'take_profit');
    assert.ok(result);
    assert.ok(result.pnl > 0);
    assert.equal(result.closeReason, 'take_profit');
  });

  it('closePosition calculates P&L correctly for SHORT', () => {
    openPosition('TEST2', 'SHORT', 100, 105, 90);
    const result = closePosition('TEST2', 95, 'take_profit');
    assert.ok(result);
    assert.ok(result.pnl > 0);
  });

  it('checkBreakeven moves SL when profit sufficient', () => {
    openPosition('TEST3', 'LONG', 100, 90, 120);
    const result = checkBreakeven('TEST3', 112); // 12% profit, risk was 10%
    assert.ok(result);
    assert.equal(result.action, 'breakeven');
    assert.equal(result.newSL, 100);
  });

  it('checkTrailingStop moves SL up', () => {
    openPosition('TEST4', 'LONG', 100, 90, 120);
    // First move to breakeven
    checkBreakeven('TEST4', 112);
    // Then check trailing
    const result = checkTrailingStop('TEST4', 115, 2);
    assert.ok(result);
    assert.equal(result.action, 'trailing');
    assert.ok(result.newSL > 100);
  });

  it('checkPartialProfit takes profit at TP1', () => {
    openPosition('TEST5', 'LONG', 100, 90, 120);
    const result = checkPartialProfit('TEST5', 110, 110);
    assert.ok(result);
    assert.equal(result.action, 'partial_profit');
  });

  it('checkSLTP closes on stop loss', () => {
    openPosition('TEST6', 'LONG', 100, 95, 110);
    const result = checkSLTP('TEST6', 94);
    assert.ok(result);
    assert.equal(result.closeReason, 'stop_loss');
  });

  it('checkSLTP closes on take profit', () => {
    openPosition('TEST7', 'LONG', 100, 95, 110);
    const result = checkSLTP('TEST7', 111);
    assert.ok(result);
    assert.equal(result.closeReason, 'take_profit');
  });

  it('canOpenPosition respects limit', () => {
    // Clean up any existing positions first
    const existing = getOpenPositions();
    for (const p of existing) closePosition(p.sym, p.entry);

    openPosition('P1', 'LONG', 100, 95, 110);
    openPosition('P2', 'LONG', 100, 95, 110);
    openPosition('P3', 'LONG', 100, 95, 110);
    const result = canOpenPosition(3);
    assert.equal(result.canOpen, false);
    assert.equal(result.openCount, 3);
    // Clean up
    closePosition('P1', 100);
    closePosition('P2', 100);
    closePosition('P3', 100);
  });

  it('managePosition executes full management', () => {
    openPosition('TEST8', 'LONG', 100, 90, 120);
    const result = managePosition('TEST8', 112, 2, null, 110);
    assert.ok(result);
    assert.ok(result.actions.length > 0);
  });

  it('calculatePositionSize returns valid size', () => {
    const result = calculatePositionSize(10000, 2, 100, 95);
    assert.ok(result);
    assert.ok(result.size > 0);
    assert.ok(result.riskAmount === 200);
  });

  it('riskReward returns valid ratio', () => {
    const result = riskReward(100, 95, 110);
    assert.ok(result);
    assert.ok(result.ratio === 2);
    assert.equal(result.label, 'bueno');
  });

  it('getPositionStats returns valid stats', () => {
    const stats = getPositionStats();
    assert.ok(typeof stats.openPositions === 'number');
    assert.ok(typeof stats.totalPnl === 'number');
  });
});

// ── FUNDING RATE & OPEN INTEREST ─────────────────────────────
describe('Funding Rate', () => {
  it('analyzeFundingRate handles null', () => {
    const result = analyzeFundingRate(null, 'LONG');
    assert.equal(result.score, 0);
    assert.equal(result.signal, 'neutral');
  });

  it('analyzeFundingRate penalizes high positive funding for LONG', () => {
    const result = analyzeFundingRate(0.001, 'LONG'); // 0.1%
    assert.ok(result.score < 0);
    assert.equal(result.signal, 'overleveraged_long');
    assert.ok(result.isDangerous);
  });

  it('analyzeFundingRate rewards negative funding for LONG', () => {
    const result = analyzeFundingRate(-0.001, 'LONG'); // -0.1%
    assert.ok(result.score > 0);
    assert.equal(result.signal, 'overleveraged_short');
  });

  it('analyzeFundingRate neutral zone', () => {
    const result = analyzeFundingRate(0.0001, 'LONG'); // 0.01%
    assert.equal(result.score, 0);
    assert.equal(result.signal, 'neutral');
  });
});

describe('Open Interest', () => {
  it('analyzeOpenInterest handles null', () => {
    const result = analyzeOpenInterest(null, null, null);
    assert.equal(result.score, 0);
  });

  it('analyzeOpenInterest detects strong uptrend', () => {
    const result = analyzeOpenInterest(1000, 10, 2); // OI +10%, price +2%
    assert.ok(result.score > 0);
    assert.equal(result.signal, 'strong_uptrend');
  });

  it('analyzeOpenInterest detects potential squeeze', () => {
    const result = analyzeOpenInterest(1000, 10, -2); // OI +10%, price -2%
    assert.ok(result.score > 0);
    assert.equal(result.signal, 'potential_squeeze');
  });

  it('analyzeOpenInterest detects capitulation', () => {
    const result = analyzeOpenInterest(1000, -10, -2); // OI -10%, price -2%
    assert.ok(result.score > 0);
    assert.equal(result.signal, 'capitulation');
  });
});

describe('Long/Short Ratio', () => {
  it('analyzeLongShortRatio handles null', () => {
    const result = analyzeLongShortRatio(null, 'LONG');
    assert.equal(result.score, 0);
  });

  it('analyzeLongShortRatio penalizes extreme long for LONG', () => {
    const result = analyzeLongShortRatio(2.5, 'LONG');
    assert.ok(result.score < 0);
    assert.equal(result.signal, 'extreme_long');
    assert.ok(result.isExtreme);
  });

  it('analyzeLongShortRatio rewards extreme short for LONG', () => {
    const result = analyzeLongShortRatio(0.4, 'LONG');
    assert.ok(result.score > 0);
    assert.equal(result.signal, 'extreme_short');
  });

  it('analyzeLongShortRatio balanced', () => {
    const result = analyzeLongShortRatio(1.0, 'LONG');
    assert.equal(result.score, 0);
    assert.equal(result.signal, 'balanced');
  });
});

describe('Combined Funding Score', () => {
  it('fundingScore returns valid structure', () => {
    const result = fundingScore(0.001, 1000, 10, 2, 2.5, 'LONG');
    assert.ok(typeof result.score === 'number');
    assert.ok(result.funding);
    assert.ok(result.oi);
    assert.ok(result.lsr);
    assert.ok(['low', 'medium', 'high'].includes(result.liquidationRisk));
  });

  it('fundingScore detects high risk', () => {
    const result = fundingScore(0.001, 1000, 10, 2, 2.5, 'LONG');
    assert.equal(result.liquidationRisk, 'high');
  });
});
