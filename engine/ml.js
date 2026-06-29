// ═══════════════════════════════════════════════════════════════
//  engine/ml.js  —  Trading Dashboard PRO v8.0
//  ML Signal Classifier: predice si una señal va a ganar
//  Implementación pura en JS (sin dependencias externas)
//  Algoritmo: Logistic Regression + Feature Engineering
// ═══════════════════════════════════════════════════════════════

import { ema, calcRSI, calcMACD, calcADX, calcATR, calcOBV } from './signals.js';
import { detectRegime } from './regime.js';

// ── FEATURE EXTRACTION ──────────────────────────────────────────
// Extrae features numéricas del estado actual del mercado
export function extractFeatures(candles, tf) {
  if (!candles || candles.length < 100) return null;

  const price = candles[candles.length - 1].close;
  const closes = candles.map(c => c.close);

  // EMAs
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const n = closes.length - 1;

  // RSI
  const rsi = calcRSI(candles, 14);

  // MACD
  const macd = calcMACD(candles);

  // ADX
  const adx = calcADX(candles, 14);

  // ATR
  const atr = calcATR(candles, 14);
  const atrPct = atr && price ? atr / price : 0;

  // OBV
  const obv = calcOBV(candles, 20);

  // Regime
  const regime = detectRegime(candles);

  // Price position relative to EMAs
  const priceVsEma20 = ema20[n] ? (price - ema20[n]) / ema20[n] : 0;
  const priceVsEma50 = ema50[n] ? (price - ema50[n]) / ema50[n] : 0;
  const priceVsEma200 = ema200[n] ? (price - ema200[n]) / ema200[n] : 0;

  // EMA slopes
  const ema20Slope = n >= 5 && ema20[n - 5] ? (ema20[n] - ema20[n - 5]) / ema20[n - 5] : 0;
  const ema50Slope = n >= 10 && ema50[n - 10] ? (ema50[n] - ema50[n - 10]) / ema50[n - 10] : 0;

  // Volume trend
  const recentVol = candles.slice(-10).reduce((a, c) => a + c.vol, 0) / 10;
  const prevVol = candles.slice(-20, -10).reduce((a, c) => a + c.vol, 0) / 10;
  const volTrend = prevVol > 0 ? (recentVol - prevVol) / prevVol : 0;

  // Price momentum (5, 10, 20 candles)
  const mom5 = n >= 5 ? (price - closes[n - 5]) / closes[n - 5] : 0;
  const mom10 = n >= 10 ? (price - closes[n - 10]) / closes[n - 10] : 0;
  const mom20 = n >= 20 ? (price - closes[n - 20]) / closes[n - 20] : 0;

  // Volatility percentile
  const atrValues = [];
  for (let i = 50; i < candles.length - 14; i++) {
    const a = calcATR(candles.slice(0, i + 14), 14);
    if (a) atrValues.push(a);
  }
  const atrPercentile = atrValues.length > 0
    ? atrValues.filter(a => a < atr).length / atrValues.length
    : 0.5;

  return {
    // Core features (normalized 0-1)
    rsi: rsi ? rsi.value / 100 : 0.5,
    rsiRising: rsi ? (rsi.rising ? 1 : 0) : 0.5,
    macdDir: macd ? (macd.dir === 'up' ? 1 : macd.dir === 'dn' ? 0 : 0.5) : 0.5,
    adxTrending: adx ? (adx.trending ? 1 : 0) : 0,
    adxDirection: adx ? (adx.dir === 'up' ? 1 : adx.dir === 'dn' ? 0 : 0.5) : 0.5,
    obvRising: obv ? (obv.rising ? 1 : 0) : 0.5,

    // Price vs EMAs (normalized)
    priceVsEma20: Math.max(-0.1, Math.min(0.1, priceVsEma20)) / 0.1,
    priceVsEma50: Math.max(-0.1, Math.min(0.1, priceVsEma50)) / 0.1,
    priceVsEma200: Math.max(-0.1, Math.min(0.1, priceVsEma200)) / 0.1,

    // EMA slopes (normalized)
    ema20Slope: Math.max(-0.01, Math.min(0.01, ema20Slope)) / 0.01,
    ema50Slope: Math.max(-0.01, Math.min(0.01, ema50Slope)) / 0.01,

    // Volume
    volTrend: Math.max(-1, Math.min(1, volTrend)),

    // Momentum
    mom5: Math.max(-0.1, Math.min(0.1, mom5)) / 0.1,
    mom10: Math.max(-0.1, Math.min(0.1, mom10)) / 0.1,
    mom20: Math.max(-0.1, Math.min(0.1, mom20)) / 0.1,

    // Volatility
    atrPct: Math.min(0.05, atrPct) / 0.05,
    atrPercentile,

    // Regime
    regimeTrending: regime?.regime === 'trending' ? 1 : 0,
    regimeRanging: regime?.regime === 'ranging' ? 1 : 0,
    regimeVolatile: regime?.regime === 'volatile' ? 1 : 0,
    regimeConfidence: regime?.confidence || 0,

    // Meta
    price, atr, atrPct: atrPct,
  };
}

// ── FEATURE NAMES ───────────────────────────────────────────────
export const FEATURE_NAMES = [
  'rsi', 'rsiRising', 'macdDir', 'adxTrending', 'adxDirection', 'obvRising',
  'priceVsEma20', 'priceVsEma50', 'priceVsEma200',
  'ema20Slope', 'ema50Slope',
  'volTrend', 'mom5', 'mom10', 'mom20',
  'atrPct', 'atrPercentile',
  'regimeTrending', 'regimeRanging', 'regimeVolatile', 'regimeConfidence',
];

// ── LOGISTIC REGRESSION ─────────────────────────────────────────
// Modelo lineal: P(win) = sigmoid(w · features + bias)
export class LogisticClassifier {
  constructor() {
    this.weights = new Array(FEATURE_NAMES.length).fill(0);
    this.bias = 0;
    this.trained = false;
    this.trainHistory = [];
  }

  // Sigmoid function
  sigmoid(z) {
    if (z > 50) return 1;
    if (z < -50) return 0;
    return 1 / (1 + Math.exp(-z));
  }

  // Predict probability of win
  predict(features) {
    if (!features || !this.trained) return 0.5;
    const vals = FEATURE_NAMES.map(f => features[f] || 0);
    let z = this.bias;
    for (let i = 0; i < vals.length; i++) {
      z += this.weights[i] * vals[i];
    }
    return this.sigmoid(z);
  }

  // Predict class (WIN/LOSS)
  predictClass(features, threshold = 0.55) {
    const prob = this.predict(features);
    return prob >= threshold ? 'WIN' : 'LOSS';
  }

  // Train with gradient descent
  train(X, y, epochs = 500, lr = 0.01) {
    if (!X || !y || X.length === 0) return;

    const m = X.length;
    const n = FEATURE_NAMES.length;

    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;

      for (let i = 0; i < m; i++) {
        const vals = FEATURE_NAMES.map(f => X[i][f] || 0);
        let z = this.bias;
        for (let j = 0; j < n; j++) z += this.weights[j] * vals[j];

        const pred = this.sigmoid(z);
        const error = pred - y[i];
        totalLoss += -y[i] * Math.log(pred + 1e-7) - (1 - y[i]) * Math.log(1 - pred + 1e-7);

        // Update weights
        for (let j = 0; j < n; j++) {
          this.weights[j] -= lr * error * vals[j] / m;
        }
        this.bias -= lr * error / m;
      }

      // L2 regularization
      const lambda = 0.001;
      for (let j = 0; j < n; j++) {
        this.weights[j] -= lr * lambda * this.weights[j];
      }

      const avgLoss = totalLoss / m;
      this.trainHistory.push(avgLoss);

      // Early stopping
      if (epoch > 10 && avgLoss > this.trainHistory[this.trainHistory.length - 2]) {
        break;
      }
    }

    this.trained = true;
  }

  // Evaluate accuracy
  evaluate(X, y) {
    if (!X || !y || X.length === 0) return 0;
    let correct = 0;
    for (let i = 0; i < X.length; i++) {
      const pred = this.predictClass(X[i]);
      if ((pred === 'WIN' && y[i] === 1) || (pred === 'LOSS' && y[i] === 0)) correct++;
    }
    return correct / X.length;
  }

  // Get feature importance
  getFeatureImportance() {
    return FEATURE_NAMES.map((name, i) => ({
      name,
      weight: this.weights[i],
      absWeight: Math.abs(this.weights[i]),
    })).sort((a, b) => b.absWeight - a.absWeight);
  }

  // Export model for serialization
  export() {
    return { weights: [...this.weights], bias: this.bias, trained: this.trained };
  }

  // Import model from serialized data
  import(data) {
    if (data.weights) this.weights = [...data.weights];
    if (data.bias != null) this.bias = data.bias;
    this.trained = data.trained || false;
  }
}

// ── DATA PREPARATION ────────────────────────────────────────────
// Convierte trades históricos en features + labels para entrenar
export function prepareTrainingData(candles, trades, tf) {
  const X = [];
  const y = [];

  for (const trade of trades) {
    // Encontrar el índice de la vela de entrada
    const entryIdx = candles.findIndex(c => c.time >= trade.entryTime);
    if (entryIdx < 100) continue; // No hay suficientes datos anteriores

    // Extraer features en el momento de la entrada
    const features = extractFeatures(candles.slice(0, entryIdx + 1), tf);
    if (!features) continue;

    X.push(features);
    y.push(trade.result === 'WIN' ? 1 : 0);
  }

  return { X, y };
}

// ── WALK-FORWARD TRAINING ───────────────────────────────────────
// Entrena el modelo en ventanas rodantes para evitar overfitting
export function walkForwardTrain(candles, tf, trainWindow = 300, testWindow = 50) {
  const models = [];
  const allPredictions = [];

  for (let start = trainWindow; start + testWindow <= candles.length; start += testWindow) {
    const trainCandles = candles.slice(0, start);
    const testCandles = candles.slice(start, start + testWindow);

    // Crear features del test set
    const testFeatures = [];
    for (let i = 100; i < testCandles.length; i++) {
      const features = extractFeatures(testCandles.slice(0, i + 1), tf);
      if (features) testFeatures.push(features);
    }

    if (testFeatures.length > 0) {
      // Usar modelo pre-entrenado o crear uno nuevo
      const model = new LogisticClassifier();
      models.push(model);
      allPredictions.push(...testFeatures.map(f => ({ features: f, prob: model.predict(f) })));
    }
  }

  return { models, predictions: allPredictions };
}
