// ═══════════════════════════════════════════════════════════════
//  engine/monte.js  —  Trading Dashboard PRO v8.0
//  Monte Carlo Simulation: stress-test strategy returns
//  Pure math — no I/O, fully testable
// ═══════════════════════════════════════════════════════════════

// ── SHUFFLE RETURNS ─────────────────────────────────────────────
// Mezcla aleatoriamente los returns para simular diferentes órdenes
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── SINGLE SIMULATION ───────────────────────────────────────────
// Ejecuta una simulación con los returns mezclados
function singleSimulation(returns, capital = 10000) {
  let equity = capital;
  let peak = capital;
  let maxDD = 0;
  let ddDuration = 0;
  let maxDDDuration = 0;
  const equityCurve = [capital];

  for (const r of returns) {
    equity *= (1 + r);
    equityCurve.push(equity);

    if (equity > peak) {
      peak = equity;
      ddDuration = 0;
    } else {
      ddDuration++;
      if (ddDuration > maxDDDuration) maxDDDuration = ddDuration;
    }

    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    finalEquity: equity,
    totalReturn: (equity - capital) / capital,
    maxDrawdown: maxDD,
    maxDDDuration,
    equityCurve,
  };
}

// ── MONTE CARLO SIMULATION ──────────────────────────────────────
// Ejecuta N simulaciones con returns mezclados aleatoriamente
export function monteCarloSimulation(trades, {
  iterations = 10000,
  capital = 10000,
  confidenceLevel = 0.95,
} = {}) {
  if (!trades || trades.length < 5) return null;

  const returns = trades.map(t => t.pnl || 0);
  const results = [];

  for (let i = 0; i < iterations; i++) {
    const shuffled = shuffle(returns);
    const sim = singleSimulation(shuffled, capital);
    results.push(sim);
  }

  // Sort results for percentile calculation
  results.sort((a, b) => a.finalEquity - b.finalEquity);

  const idx = (p) => Math.floor(p * (results.length - 1));

  // Percentiles
  const p5 = results[idx(0.05)];
  const p10 = results[idx(0.10)];
  const p25 = results[idx(0.25)];
  const p50 = results[idx(0.50)]; // Median
  const p75 = results[idx(0.75)];
  const p90 = results[idx(0.90)];
  const p95 = results[idx(0.95)];

  // Statistics
  const totalReturns = results.map(r => r.totalReturn);
  const avgReturn = totalReturns.reduce((a, b) => a + b, 0) / totalReturns.length;
  const stdReturn = Math.sqrt(totalReturns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / totalReturns.length);

  const maxDDs = results.map(r => r.maxDrawdown);
  const avgMaxDD = maxDDs.reduce((a, b) => a + b, 0) / maxDDs.length;
  const worstDD = Math.max(...maxDDs);

  // Probability of loss
  const probLoss = results.filter(r => r.totalReturn < 0).length / results.length;
  const probRuin = results.filter(r => r.finalEquity < capital * 0.5).length / results.length; // 50% loss

  // Confidence interval
  const ciLow = results[idx((1 - confidenceLevel) / 2)];
  const ciHigh = results[idx(1 - (1 - confidenceLevel) / 2)];

  // Profit Factor distribution
  const profits = results.map(r => {
    const wins = trades.filter(t => (t.pnl || 0) > 0).reduce((a, t) => a + t.pnl, 0);
    const losses = Math.abs(trades.filter(t => (t.pnl || 0) < 0).reduce((a, t) => a + t.pnl, 0));
    return losses > 0 ? wins / losses : 999;
  });

  // Risk of Ruin curve
  const ruinThresholds = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
  const riskOfRuin = ruinThresholds.map(threshold => ({
    threshold: `${(1 - threshold) * 100}% loss`,
    probability: results.filter(r => r.finalEquity < capital * threshold).length / results.length,
  }));

  return {
    iterations,
    capital,
    confidenceLevel,

    // Central tendency
    avgReturn: +(avgReturn * 100).toFixed(2),
    stdReturn: +(stdReturn * 100).toFixed(2),
    medianReturn: +(p50.totalReturn * 100).toFixed(2),

    // Percentiles
    percentiles: {
      p5: +((p5.finalEquity - capital) / capital * 100).toFixed(2),
      p10: +((p10.finalEquity - capital) / capital * 100).toFixed(2),
      p25: +((p25.finalEquity - capital) / capital * 100).toFixed(2),
      p50: +((p50.finalEquity - capital) / capital * 100).toFixed(2),
      p75: +((p75.finalEquity - capital) / capital * 100).toFixed(2),
      p90: +((p90.finalEquity - capital) / capital * 100).toFixed(2),
      p95: +((p95.finalEquity - capital) / capital * 100).toFixed(2),
    },

    // Equity at percentiles
    equity: {
      p5: +p5.finalEquity.toFixed(2),
      p10: +p10.finalEquity.toFixed(2),
      p25: +p25.finalEquity.toFixed(2),
      p50: +p50.finalEquity.toFixed(2),
      p75: +p75.finalEquity.toFixed(2),
      p90: +p90.finalEquity.toFixed(2),
      p95: +p95.finalEquity.toFixed(2),
    },

    // Drawdown stats
    avgMaxDrawdown: +(avgMaxDD * 100).toFixed(2),
    worstDrawdown: +(worstDD * 100).toFixed(2),

    // Risk metrics
    probabilityOfLoss: +(probLoss * 100).toFixed(2),
    probabilityOfRuin: +(probRuin * 100).toFixed(2),

    // Confidence interval
    confidenceInterval: {
      low: +((ciLow.finalEquity - capital) / capital * 100).toFixed(2),
      high: +((ciHigh.finalEquity - capital) / capital * 100).toFixed(2),
    },

    // Risk of ruin curve
    riskOfRuin,

    // Raw results for further analysis
    results: results.slice(0, 100), // Keep first 100 for display
  };
}

// ── MONTE CARLO REPORT ──────────────────────────────────────────
// Genera reporte legible de los resultados
export function monteCarloReport(mc) {
  if (!mc) return 'No simulation data';

  const lines = [
    `═══ MONTE CARLO SIMULATION (${mc.iterations.toLocaleString()} iterations) ═══`,
    '',
    `Capital: $${mc.capital.toLocaleString()}`,
    '',
    '─── RETURN DISTRIBUTION ───',
    `Average Return:    ${mc.avgReturn > 0 ? '+' : ''}${mc.avgReturn}%`,
    `Std Deviation:     ${mc.stdReturn}%`,
    `Median Return:     ${mc.medianReturn > 0 ? '+' : ''}${mc.medianReturn}%`,
    '',
    '─── PERCENTILES ───',
    ` 5th (Worst case): ${mc.percentiles.p5 > 0 ? '+' : ''}${mc.percentiles.p5}% ($${mc.equity.p5.toLocaleString()})`,
    `25th (Bearish):    ${mc.percentiles.p25 > 0 ? '+' : ''}${mc.percentiles.p25}% ($${mc.equity.p25.toLocaleString()})`,
    `50th (Median):     ${mc.percentiles.p50 > 0 ? '+' : ''}${mc.percentiles.p50}% ($${mc.equity.p50.toLocaleString()})`,
    `75th (Bullish):    ${mc.percentiles.p75 > 0 ? '+' : ''}${mc.percentiles.p75}% ($${mc.equity.p75.toLocaleString()})`,
    `95th (Best case):  ${mc.percentiles.p95 > 0 ? '+' : ''}${mc.percentiles.p95}% ($${mc.equity.p95.toLocaleString()})`,
    '',
    '─── RISK METRICS ───',
    `Probability of Loss:    ${mc.probabilityOfLoss}%`,
    `Probability of Ruin:    ${mc.probabilityOfRuin}% (50%+ loss)`,
    `Average Max Drawdown:   ${mc.avgMaxDrawdown}%`,
    `Worst Drawdown:         ${mc.worstDrawdown}%`,
    '',
    `─── ${mc.confidenceLevel * 100}% CONFIDENCE INTERVAL ───`,
    `Low:  ${mc.confidenceInterval.low > 0 ? '+' : ''}${mc.confidenceInterval.low}%`,
    `High: ${mc.confidenceInterval.high > 0 ? '+' : ''}${mc.confidenceInterval.high}%`,
    '',
    '─── RISK OF RUIN CURVE ───',
  ];

  for (const r of mc.riskOfRuin) {
    const bar = '█'.repeat(Math.round(r.probability * 20));
    lines.push(`${r.threshold.padEnd(12)} ${bar} ${(r.probability * 100).toFixed(1)}%`);
  }

  return lines.join('\n');
}

// ── STRATEGY ROBUSTNESS SCORE ───────────────────────────────────
// Califica la robustez de una estrategia basada en Monte Carlo
export function robustnessScore(mc) {
  if (!mc) return 0;

  let score = 0;

  // Probability of profit (max 25 pts)
  score += (1 - mc.probabilityOfLoss / 100) * 25;

  // Low ruin probability (max 25 pts)
  score += (1 - mc.probabilityOfRuin / 100) * 25;

  // Positive median return (max 20 pts)
  if (mc.medianReturn > 0) score += Math.min(20, mc.medianReturn * 2);

  // Low worst drawdown (max 15 pts)
  if (mc.worstDrawdown < 30) score += 15;
  else if (mc.worstDrawdown < 50) score += 10;
  else if (mc.worstDrawdown < 70) score += 5;

  // Tight confidence interval (max 15 pts)
  const ciWidth = mc.confidenceInterval.high - mc.confidenceInterval.low;
  if (ciWidth < 20) score += 15;
  else if (ciWidth < 40) score += 10;
  else if (ciWidth < 60) score += 5;

  return Math.round(Math.min(100, score));
}
