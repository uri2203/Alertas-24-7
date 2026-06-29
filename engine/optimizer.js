// ═══════════════════════════════════════════════════════════════
//  engine/optimizer.js  —  Trading Dashboard PRO v8.0
//  Genetic Algorithm Parameter Optimization per crypto/TF
//  Pure math — no I/O, fully testable
// ═══════════════════════════════════════════════════════════════

import { runBacktest, calcMetrics } from './backtester.js';

// ── GENE STRUCTURE ──────────────────────────────────────────────
// Cada gen representa un set de parámetros del sistema de señales
export function createGene() {
  return {
    // Score weights (0.5 - 3.0)
    wEma: 1.0 + Math.random() * 2,
    wFld: 1.5 + Math.random() * 1.5,
    wMacd: 1.5 + Math.random() * 1.5,
    wAdx: 1.0 + Math.random() * 2,
    wRsiVol: 1.0 + Math.random() * 2,
    wObv: 0.5 + Math.random() * 2,
    wElliott: 0.5 + Math.random() * 2,
    wFib: 0.5 + Math.random() * 2,
    wPivot: 0.5 + Math.random() * 2,
    wTfMayor: 0.5 + Math.random() * 2,
    wRR: 0.5 + Math.random() * 2,

    // Thresholds
    minScore: 5.5 + Math.random() * 3,  // 5.5 - 8.5
    trendThreshold: 0.0005 + Math.random() * 0.002,

    // SL/TP multipliers
    slAtrMult: 1.0 + Math.random() * 3,    // 1 - 4 ATR
    tpAtrMult: 1.5 + Math.random() * 4,    // 1.5 - 5.5 ATR

    // Conditions
    minRsiDivergence: 10 + Math.random() * 20,  // 10-30 pts
    minObvStrength: 0.3 + Math.random() * 0.4,
  };
}

// ── MUTATION ────────────────────────────────────────────────────
export function mutate(gene, mutationRate = 0.2) {
  const mutated = { ...gene };
  const keys = Object.keys(mutated);

  for (const key of keys) {
    if (Math.random() < mutationRate) {
      const val = mutated[key];
      const range = val * 0.3; // ±30%
      mutated[key] = Math.max(0.1, val + (Math.random() * 2 - 1) * range);
    }
  }

  // Enforce bounds
  mutated.minScore = Math.max(4, Math.min(10, mutated.minScore));
  mutated.slAtrMult = Math.max(0.5, Math.min(5, mutated.slAtrMult));
  mutated.tpAtrMult = Math.max(1, Math.min(8, mutated.tpAtrMult));

  return mutated;
}

// ── CROSSOVER ───────────────────────────────────────────────────
export function crossover(parent1, parent2) {
  const child = {};
  const keys = Object.keys(parent1);

  for (const key of keys) {
    // Uniform crossover
    child[key] = Math.random() < 0.5 ? parent1[key] : parent2[key];
  }

  return child;
}

// ── SELECTION ───────────────────────────────────────────────────
// Tournament selection: pick best from random subset
export function select(population, fitnessScores, tournamentSize = 3) {
  let bestIdx = Math.floor(Math.random() * population.length);
  let bestFit = fitnessScores[bestIdx];

  for (let i = 1; i < tournamentSize; i++) {
    const idx = Math.floor(Math.random() * population.length);
    if (fitnessScores[idx] > bestFit) {
      bestIdx = idx;
      bestFit = fitnessScores[idx];
    }
  }

  return population[bestIdx];
}

// ── FITNESS FUNCTION ────────────────────────────────────────────
// Evalúa un gene ejecutando backtest y calculando score compuesto
export function calcFitness(gene, candles, tf) {
  // Simular señal con estos parámetros
  const metrics = simulateWithGene(gene, candles, tf);

  if (!metrics || metrics.trades < 5) return -100; // Mínimo trades

  // Score compuesto: balancea profit factor, Sharpe, drawdown, win rate
  const fitness =
    (metrics.profitFactor - 1) * 10 +        // PF > 1 = profitable
    metrics.sharpe * 3 +                       // Sharpe alto
    (1 - metrics.maxDrawdown) * 5 +            // Bajo drawdown
    (metrics.winRate > 0.4 ? (metrics.winRate - 0.4) * 20 : -10) + // WR > 40%
    Math.min(metrics.trades / 50, 1) * 5 +    // Suficientes trades
    (metrics.avgRiskReward > 1.5 ? 5 : 0);    // Buen R:R

  return fitness;
}

// ── SIMULATE WITH GENE ──────────────────────────────────────────
// Ejecuta backtest con los parámetros de un gene
function simulateWithGene(gene, candles, tf) {
  if (!candles || candles.length < 100) return null;

  const trades = [];
  let inTrade = false;
  let entryPrice = 0, sl = 0, tp = 0, signal = '';
  let entryTime = 0;

  for (let i = 100; i < candles.length; i++) {
    const c = candles[i];

    if (inTrade) {
      // Check SL/TP
      if (signal === 'LONG') {
        if (c.low <= sl) {
          trades.push({ result: 'LOSS', pnl: (sl - entryPrice) / entryPrice, entryTime, exitTime: c.time });
          inTrade = false;
        } else if (c.high >= tp) {
          trades.push({ result: 'WIN', pnl: (tp - entryPrice) / entryPrice, entryTime, exitTime: c.time });
          inTrade = false;
        }
      } else {
        if (c.high >= sl) {
          trades.push({ result: 'LOSS', pnl: (entryPrice - sl) / entryPrice, entryTime, exitTime: c.time });
          inTrade = false;
        } else if (c.low <= tp) {
          trades.push({ result: 'WIN', pnl: (entryPrice - tp) / entryPrice, entryTime, exitTime: c.time });
          inTrade = false;
        }
      }

      // Timeout 48 velas
      if (inTrade && i - candles.findIndex(cv => cv.time === entryTime) >= 48) {
        const exitPrice = c.close;
        const pnl = signal === 'LONG'
          ? (exitPrice - entryPrice) / entryPrice
          : (entryPrice - exitPrice) / entryPrice;
        trades.push({ result: pnl > 0 ? 'WIN' : 'LOSS', pnl, entryTime, exitTime: c.time });
        inTrade = false;
      }
    } else {
      // Evaluar señal simplificada con parámetros del gene
      const closes = candles.slice(0, i + 1).map(cv => cv.close);
      if (closes.length < 50) continue;

      const { ema: emaFn, calcRSI: rsiFn, calcMACD: macdFn } = await import('./signals.js');
      const ema20 = emaFn(closes, 20);
      const ema50 = emaFn(closes, 50);
      const rsi = rsiFn(candles.slice(0, i + 1), 14);
      const macd = macdFn(candles.slice(0, i + 1));

      if (!ema20[i] || !ema50[i] || !rsi || !macd) continue;

      // Scoring con pesos del gene
      let score = 0;
      if (ema20[i] > ema50[i]) score += gene.wEma * 1.5;
      if (macd.dir === 'up') score += gene.wMacd * 1.5;
      if (rsi.value > 50 && rsi.value < 70) score += gene.wRsiVol * 1.5;
      if (rsi.value < 30) score += gene.wRsiVol * 2.5; // Oversold bonus

      if (score >= gene.minScore) {
        entryPrice = c.close;
        const atr = candles.slice(i - 13, i + 1).reduce((a, cv) => {
          const tr = Math.max(cv.high - cv.low, Math.abs(cv.high - cv.close), Math.abs(cv.low - cv.close));
          return a + tr;
        }, 0) / 14;

        if (signal === 'LONG' || (!signal && score > 5)) {
          signal = 'LONG';
          sl = entryPrice - atr * gene.slAtrMult;
          tp = entryPrice + atr * gene.tpAtrMult;
        } else {
          signal = 'SHORT';
          sl = entryPrice + atr * gene.slAtrMult;
          tp = entryPrice - atr * gene.tpAtrMult;
        }

        inTrade = true;
        entryTime = c.time;
      }
    }
  }

  return calcMetrics(trades);
}

// ── GENETIC ALGORITHM ───────────────────────────────────────────
export function geneticOptimize(candles, tf, {
  popSize = 30,
  generations = 20,
  mutationRate = 0.2,
  eliteSize = 3,
} = {}) {
  // Initialize population
  let population = Array.from({ length: popSize }, () => createGene());
  const history = [];

  for (let gen = 0; gen < generations; gen++) {
    // Evaluate fitness
    const fitnessScores = population.map(g => calcFitness(g, candles, tf));

    // Track best
    const bestIdx = fitnessScores.indexOf(Math.max(...fitnessScores));
    const bestGene = population[bestIdx];
    const bestFitness = fitnessScores[bestIdx];
    history.push({ gen, bestFitness, avgFitness: fitnessScores.reduce((a, b) => a + b, 0) / fitnessScores.length });

    // Sort by fitness
    const sorted = population.map((g, i) => ({ gene: g, fit: fitnessScores[i] }))
      .sort((a, b) => b.fit - a.fit);

    // Keep elites
    const newPop = sorted.slice(0, eliteSize).map(e => e.gene);

    // Fill rest with crossover + mutation
    while (newPop.length < popSize) {
      const p1 = select(population, fitnessScores);
      const p2 = select(population, fitnessScores);
      let child = crossover(p1, p2);
      child = mutate(child, mutationRate);
      newPop.push(child);
    }

    population = newPop;
  }

  // Final evaluation
  const finalFitness = population.map(g => calcFitness(g, candles, tf));
  const bestIdx = finalFitness.indexOf(Math.max(...finalFitness));

  return {
    bestGene: population[bestIdx],
    bestFitness: finalFitness[bestIdx],
    history,
    allGenes: population,
    allFitness: finalFitness,
  };
}

// ── OPTIMIZE PER CRYPTO ─────────────────────────────────────────
export function optimizePerSymbol(results, tf) {
  const optimized = {};

  for (const [symbol, data] of Object.entries(results)) {
    if (data.candles && data.candles.length > 200) {
      const opt = geneticOptimize(data.candles, tf, {
        popSize: 20,
        generations: 15,
        eliteSize: 2,
      });
      optimized[symbol] = opt.bestGene;
    }
  }

  return optimized;
}
