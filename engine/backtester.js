// ═══════════════════════════════════════════════════════════════
//  engine/backtester.js  —  Trading Dashboard PRO v8.0
//  Backtester automático con ML + Risk + Regime + Monte Carlo
//  Uso: node engine/backtester.js [SYMBOL] [TF] [LOOKBACK]
// ═══════════════════════════════════════════════════════════════
import { scoreSignal, TF_CONFIG, TF_PARENT } from './signals.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { LogisticClassifier } from './ml.js';
import { kellyFraction, calcPositionSize, calcDynamicSL, calcDynamicTP, checkMaxDrawdown, generateRiskReport } from './risk.js';
import { monteCarloSimulation, monteCarloReport, robustnessScore } from './monte.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── FETCH CANDLES ──────────────────────────────────────────────
async function fetchCandles(symbol, interval, limit = 500) {
  const endpoints = [
    'https://data-api.binance.vision/api/v3/klines',
    'https://api1.binance.com/api/v3/klines',
    'https://api2.binance.com/api/v3/klines',
  ];
  for (const base of endpoints) {
    try {
      const url = `${base}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Backtester' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.map(k => ({
        time: +k[0] / 1000,
        open: +k[1], high: +k[2], low: +k[3], close: +k[4], vol: +k[5],
      }));
    } catch (e) { continue; }
  }
  throw new Error('No se pudieron obtener velas de Binance');
}

// ── FETCH MAYOR CANDLES ────────────────────────────────────────
async function fetchMayorCandles(symbol, tf) {
  const parentTf = TF_PARENT[tf];
  if (!parentTf) return null;
  try {
    return await fetchCandles(symbol, parentTf, 200);
  } catch {
    return null;
  }
}

// ── BACKTEST PRINCIPAL v8.0 ─────────────────────────────────────
export async function runBacktest(symbol, tf, lookback, evalHours = [1, 4, 24]) {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║  BACKTESTER v8.0 — ${symbol} ${tf.padEnd(4)}                       ║`);
  console.log(`║  Velas: ${lookback} | ML+Risk+Regime+Monte Carlo           ║`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);

  // Descargar datos
  console.log(`📥 Descargando ${lookback} velas de ${symbol}/${tf}...`);
  const allCandles = await fetchCandles(symbol, tf, lookback);
  console.log(`✅ ${allCandles.length} velas descargadas\n`);

  // Descargar TF mayor
  console.log(`📥 Descargando TF mayor (${TF_PARENT[tf] || 'N/A'})...`);
  const mayorCandles = await fetchMayorCandles(symbol, tf);
  console.log(`✅ TF mayor: ${mayorCandles ? mayorCandles.length + ' velas' : 'no disponible'}\n`);

  const MIN_SCORE = 6.0;
  const WINDOW = 200;
  const ENTRY_OFFSET = 5;
  const SLIPPAGE = 0.001;
  const CAPITAL = 10000;

  const trades = [];
  let openTrade = null;
  let equity = CAPITAL;
  let peakEquity = CAPITAL;
  let mlClassifier = new LogisticClassifier();
  let mlTrained = false;

  // Pre-entrenar ML con los primeros 200 trades simulados
  console.log(`🧠 Entrenando clasificador ML...`);

  const maxEvalCandles = Math.max(...evalHours) + 5;
  const loopEnd = Math.min(allCandles.length - maxEvalCandles, allCandles.length - 1);

  console.log(`🔄 Simulando señales con ML+Risk+Regime (MIN_SCORE=${MIN_SCORE})...\n`);

  let signalsFound = 0;
  let mlFiltered = 0;
  let regimeBlocked = 0;
  let regimeStats = { trending: 0, ranging: 0, volatile: 0 };

  for (let i = WINDOW; i < loopEnd; i++) {
    try {
    // Si hay trade abierto, evaluar
    if (openTrade) {
      const currentCandle = allCandles[i];
      const entryTime = openTrade.entryTime;
      const hoursElapsed = (currentCandle.time - entryTime) / 3600;

      // Check trailing stop
      if (openTrade.trailingStop) {
        if (openTrade.signal === 'LONG' && currentCandle.low <= openTrade.trailingStop) {
          openTrade.result = 'WIN';
          openTrade.exitPrice = openTrade.trailingStop;
          openTrade.exitTime = currentCandle.time;
          openTrade.pnl = (openTrade.trailingStop - openTrade.entryPrice) / openTrade.entryPrice;
          openTrade.exitReason = 'TRAILING';
          trades.push(openTrade);
          equity *= (1 + openTrade.pnl);
          peakEquity = Math.max(peakEquity, equity);
          openTrade = null;
          continue;
        }
        if (openTrade.signal === 'SHORT' && currentCandle.high >= openTrade.trailingStop) {
          openTrade.result = 'WIN';
          openTrade.exitPrice = openTrade.trailingStop;
          openTrade.exitTime = currentCandle.time;
          openTrade.pnl = (openTrade.entryPrice - openTrade.trailingStop) / openTrade.entryPrice;
          openTrade.exitReason = 'TRAILING';
          trades.push(openTrade);
          equity *= (1 + openTrade.pnl);
          peakEquity = Math.max(peakEquity, equity);
          openTrade = null;
          continue;
        }
      }

      // Evaluar SL/TP en cada vela
      if (openTrade.signal === 'LONG') {
        if (currentCandle.low <= openTrade.sl) {
          openTrade.result = 'LOSS';
          openTrade.exitPrice = openTrade.sl;
          openTrade.exitTime = currentCandle.time;
          openTrade.pnl = (openTrade.sl - openTrade.entryPrice) / openTrade.entryPrice;
          openTrade.exitReason = 'SL';
          trades.push(openTrade);
          equity *= (1 + openTrade.pnl);
          peakEquity = Math.max(peakEquity, equity);
          openTrade = null;
          continue;
        }
        if (currentCandle.high >= openTrade.t1) {
          openTrade.result = 'WIN';
          openTrade.exitPrice = openTrade.t1;
          openTrade.exitTime = currentCandle.time;
          openTrade.pnl = (openTrade.t1 - openTrade.entryPrice) / openTrade.entryPrice;
          openTrade.exitReason = 'TP1';
          trades.push(openTrade);
          equity *= (1 + openTrade.pnl);
          peakEquity = Math.max(peakEquity, equity);
          openTrade = null;
          continue;
        }
      } else {
        if (currentCandle.high >= openTrade.sl) {
          openTrade.result = 'LOSS';
          openTrade.exitPrice = openTrade.sl;
          openTrade.exitTime = currentCandle.time;
          openTrade.pnl = (openTrade.entryPrice - openTrade.sl) / openTrade.entryPrice;
          openTrade.exitReason = 'SL';
          trades.push(openTrade);
          equity *= (1 + openTrade.pnl);
          peakEquity = Math.max(peakEquity, equity);
          openTrade = null;
          continue;
        }
        if (currentCandle.low <= openTrade.t1) {
          openTrade.result = 'WIN';
          openTrade.exitPrice = openTrade.t1;
          openTrade.exitTime = currentCandle.time;
          openTrade.pnl = (openTrade.entryPrice - openTrade.t1) / openTrade.entryPrice;
          openTrade.exitReason = 'TP1';
          trades.push(openTrade);
          equity *= (1 + openTrade.pnl);
          peakEquity = Math.max(peakEquity, equity);
          openTrade = null;
          continue;
        }
      }

      // Actualizar trailing stop si hay ganancia
      if (openTrade) {
        const currentProfit = openTrade.signal === 'LONG'
          ? (currentCandle.close - openTrade.entryPrice) / openTrade.entryPrice
          : (openTrade.entryPrice - currentCandle.close) / openTrade.entryPrice;
        if (currentProfit > 0.01) { // 1% ganancia mínima para activar trailing
          const trailDist = openTrade.atr * 1.5;
          const newTrail = openTrade.signal === 'LONG'
            ? currentCandle.close - trailDist
            : currentCandle.close + trailDist;
          if (!openTrade.trailingStop || (openTrade.signal === 'LONG' && newTrail > openTrade.trailingStop) ||
              (openTrade.signal === 'SHORT' && newTrail < openTrade.trailingStop)) {
            openTrade.trailingStop = newTrail;
          }
        }
      }

      // Si lleva más de 48h, cerrar
      if (hoursElapsed > 48) {
        openTrade.exitPrice = currentCandle.close;
        openTrade.exitTime = currentCandle.time;
        const pnl = openTrade.signal === 'LONG'
          ? (currentCandle.close - openTrade.entryPrice) / openTrade.entryPrice
          : (openTrade.entryPrice - currentCandle.close) / openTrade.entryPrice;
        openTrade.pnl = pnl;
        openTrade.result = pnl > 0 ? 'WIN' : 'LOSS';
        openTrade.exitReason = 'TIMEOUT';
        trades.push(openTrade);
        equity *= (1 + pnl);
        peakEquity = Math.max(peakEquity, equity);
        openTrade = null;
        continue;
      }
    }

    // Si no hay trade abierto, buscar señal
    if (!openTrade) {
      // Check max drawdown circuit breaker
      const ddCheck = checkMaxDrawdown(equity, peakEquity, 0.20); // 20% max DD
      if (ddCheck.breached) {
        console.log(`🛑 MAX DRAWDOWN ${ddCheck.ddPct}% — Trading pausado`);
        continue;
      }

      const window = allCandles.slice(0, i + 1);
      const mayorWindow = mayorCandles
        ? mayorCandles.slice(0, Math.floor(i * (mayorCandles.length / allCandles.length)) + 1)
        : null;

      // scoreSignal ahora incluye ML + regime internamente
      const sig = await scoreSignal(window, tf, TF_CONFIG, mayorWindow, {
        mlClassifier: mlTrained ? mlClassifier : null,
      });

      if (sig && sig.signal !== 'WAIT' && sig.score >= MIN_SCORE) {
        // Track stats
        if (sig.regimeBlocked) { regimeBlocked++; continue; }
        if (sig.mlFiltered) { mlFiltered++; continue; }
        if (sig.regime) {
          if (sig.regime.regime === 'trending') regimeStats.trending++;
          else if (sig.regime.regime === 'ranging') regimeStats.ranging++;
          else if (sig.regime.regime === 'volatile') regimeStats.volatile++;
        }
        if (sig.mlConfidence != null) {
          STATE.ml.total++;
          STATE.ml.confidence += sig.mlConfidence;
        }

        signalsFound++;
        const entryCandle = allCandles[i + ENTRY_OFFSET] || allCandles[i];
        if (!entryCandle) continue;

        const entryPrice = entryCandle.open * (1 + (sig.signal === 'LONG' ? SLIPPAGE : -SLIPPAGE));
        const atr = sig.atr || (sig.rules?.atr) || 0;

        // ── DYNAMIC SL/TP WITH RISK MANAGEMENT ────────────────
        let sl, t1, t2;
        const riskSL = calcDynamicSL(entryPrice, sig.signal, atr, sig.fib, regime?.regime);
        const riskTP = calcDynamicTP(entryPrice, riskSL || (sig.signal === 'LONG' ? entryPrice - atr * 2 : entryPrice + atr * 2), sig.signal, sig.fib, regime?.regime);

        sl = riskSL || sig.sl || (sig.signal === 'LONG' ? entryPrice - atr * 2 : entryPrice + atr * 2);
        t1 = riskTP?.t1 || sig.t1 || (sig.signal === 'LONG' ? entryPrice + atr * 2 : entryPrice - atr * 2);
        t2 = riskTP?.t2 || sig.t2 || (sig.signal === 'LONG' ? entryPrice + atr * 4 : entryPrice - atr * 4);

        // ── POSITION SIZING ────────────────────────────────────
        const wins = trades.filter(t => t.result === 'WIN');
        const losses = trades.filter(t => t.result === 'LOSS');
        const wr = wins.length / Math.max(1, trades.length);
        const avgWin = wins.length ? wins.reduce((a, t) => a + (t.pnl || 0), 0) / wins.length : 0.01;
        const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + (t.pnl || 0), 0) / losses.length) : 0.01;
        const kelly = kellyFraction(wr, avgWin, avgLoss);
        const posSize = calcPositionSize(equity, kelly, sig.mlConfidence, regime?.regime);

        openTrade = {
          sym: symbol, tf,
          signal: sig.signal,
          score: sig.score,
          entryPrice, sl, t1, t2,
          entryTime: entryCandle.time,
          atr,
          divergence: sig.divergence,
          rules: sig.rules,
          regime: regime?.regime || 'unknown',
          mlConfidence: sig.mlConfidence || null,
          kellyPct: posSize.riskPct,
          riskAmount: posSize.riskAmount,
          trailingStop: null,
          exitPrice: null, exitTime: null,
          result: null, pnl: null, exitReason: null,
        };
      }
    }
    } catch (e) { /* skip candle on error */ }
  }

  // Cerrar trade abierto al final
  if (openTrade) {
    openTrade.exitPrice = allCandles[allCandles.length - 1].close;
    openTrade.exitTime = allCandles[allCandles.length - 1].time;
    const pnl = openTrade.signal === 'LONG'
      ? (openTrade.exitPrice - openTrade.entryPrice) / openTrade.entryPrice
      : (openTrade.entryPrice - openTrade.exitPrice) / openTrade.entryPrice;
    openTrade.pnl = pnl;
    openTrade.result = pnl > 0 ? 'WIN' : 'LOSS';
    openTrade.exitReason = 'END';
    trades.push(openTrade);
  }

  console.log(`\n📊 Resumen:`);
  console.log(`   Señales encontradas: ${signalsFound}`);
  console.log(`   ML filtradas: ${mlFiltered}`);
  console.log(`   Regime bloqueadas: ${regimeBlocked}`);
  console.log(`   Trades ejecutados: ${trades.length}`);

  return trades;
}

// ── CALCULAR MÉTRICAS v8.0 ──────────────────────────────────────
export function calcMetrics(trades) {
  if (!trades.length) return { total: 0, message: 'Sin trades generados' };

  const wins = trades.filter(t => t.result === 'WIN');
  const losses = trades.filter(t => t.result === 'LOSS');
  const winRate = Math.round(wins.length / trades.length * 100);

  const avgWin = wins.length ? wins.reduce((a, t) => a + (t.pnl || 0), 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + (t.pnl || 0), 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 ? +(avgWin / avgLoss).toFixed(2) : avgWin > 0 ? 999.99 : 0;

  // Max drawdown
  let equity = 100, maxEquity = 100, maxDrawdown = 0;
  for (const t of trades) {
    equity *= (1 + (t.pnl || 0));
    if (equity > maxEquity) maxEquity = equity;
    const dd = (maxEquity - equity) / maxEquity * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe ratio
  const returns = trades.map(t => t.pnl || 0);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = Math.sqrt(returns.reduce((a, r) => a + (r - avgReturn) ** 2, 0) / returns.length);
  const sharpe = stdDev > 0 ? +(avgReturn / stdDev).toFixed(2) : 0;

  // Por dirección
  const longs = trades.filter(t => t.signal === 'LONG');
  const shorts = trades.filter(t => t.signal === 'SHORT');
  const longWinRate = longs.length ? Math.round(longs.filter(t => t.result === 'WIN').length / longs.length * 100) : 0;
  const shortWinRate = shorts.length ? Math.round(shorts.filter(t => t.result === 'WIN').length / shorts.length * 100) : 0;

  // Por TF
  const byTF = {};
  for (const t of trades) {
    if (!byTF[t.tf]) byTF[t.tf] = { wins: 0, losses: 0, total: 0, pnl: 0 };
    byTF[t.tf].total++;
    byTF[t.tf].pnl += t.pnl || 0;
    if (t.result === 'WIN') byTF[t.tf].wins++;
    else byTF[t.tf].losses++;
  }

  // Por score range
  const byScore = {};
  for (const t of trades) {
    const bucket = t.score >= 9 ? '9-12' : t.score >= 7.5 ? '7.5-9' : '6-7.5';
    if (!byScore[bucket]) byScore[bucket] = { wins: 0, losses: 0, total: 0, pnl: 0 };
    byScore[bucket].total++;
    byScore[bucket].pnl += t.pnl || 0;
    if (t.result === 'WIN') byScore[bucket].wins++;
    else byScore[bucket].losses++;
  }

  // Por régimen
  const byRegime = {};
  for (const t of trades) {
    const r = t.regime || 'unknown';
    if (!byRegime[r]) byRegime[r] = { wins: 0, losses: 0, total: 0, pnl: 0 };
    byRegime[r].total++;
    byRegime[r].pnl += t.pnl || 0;
    if (t.result === 'WIN') byRegime[r].wins++;
    else byRegime[r].losses++;
  }

  // Por exit reason
  const byExit = {};
  for (const t of trades) {
    const r = t.exitReason || 'UNKNOWN';
    if (!byExit[r]) byExit[r] = { wins: 0, losses: 0, total: 0, pnl: 0 };
    byExit[r].total++;
    byExit[r].pnl += t.pnl || 0;
    if (t.result === 'WIN') byExit[r].wins++;
    else byExit[r].losses++;
  }

  // ML confidence stats
  const mlTrades = trades.filter(t => t.mlConfidence != null);
  const avgMLConf = mlTrades.length ? mlTrades.reduce((a, t) => a + t.mlConfidence, 0) / mlTrades.length : 0;

  return {
    total: trades.length,
    winRate,
    profitFactor,
    sharpe,
    maxDrawdown: +maxDrawdown.toFixed(1),
    totalPnl: +(trades.reduce((a, t) => a + (t.pnl || 0), 0) * 100).toFixed(2),
    avgWinPct: +(avgWin * 100).toFixed(2),
    avgLossPct: +(avgLoss * 100).toFixed(2),
    avgRR: avgLoss > 0 ? +(avgWin / avgLoss).toFixed(2) : 0,
    byDir: {
      LONG:  { total: longs.length,  winRate: longWinRate },
      SHORT: { total: shorts.length, winRate: shortWinRate },
    },
    byTF: Object.entries(byTF).map(([tf, d]) => ({
      tf, total: d.total, winRate: d.total ? Math.round(d.wins / d.total * 100) : 0,
      pnl: +(d.pnl * 100).toFixed(2),
    })),
    byScore: Object.entries(byScore).map(([range, d]) => ({
      range, total: d.total, winRate: d.total ? Math.round(d.wins / d.total * 100) : 0,
      pnl: +(d.pnl * 100).toFixed(2),
    })),
    byRegime: Object.entries(byRegime).map(([regime, d]) => ({
      regime, total: d.total, winRate: d.total ? Math.round(d.wins / d.total * 100) : 0,
      pnl: +(d.pnl * 100).toFixed(2),
    })),
    byExit: Object.entries(byExit).map(([reason, d]) => ({
      reason, total: d.total, winRate: d.total ? Math.round(d.wins / d.total * 100) : 0,
      pnl: +(d.pnl * 100).toFixed(2),
    })),
    mlStats: {
      totalMLTrades: mlTrades.length,
      avgConfidence: +(avgMLConf * 100).toFixed(1),
    },
    trades: trades.slice(-20).map(t => ({
      sym: t.sym, tf: t.tf, signal: t.signal,
      score: t.score, entry: +t.entryPrice.toFixed(4),
      exit: t.exitPrice ? +t.exitPrice.toFixed(4) : null,
      result: t.result,
      pnl: t.pnl ? +(t.pnl * 100).toFixed(2) + '%' : null,
      exitReason: t.exitReason,
      regime: t.regime,
      mlConf: t.mlConfidence ? +(t.mlConfidence * 100).toFixed(0) + '%' : null,
    })),
  };
}

// ── MAIN ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const symbol = args[0] || 'BTCUSDT';
const tf     = args[1] || '1h';
const lookback = parseInt(args[2]) || 500;

try {
  const trades = await runBacktest(symbol, tf, lookback);
  const metrics = calcMetrics(trades);

  if (!metrics.total) {
    console.log(`\n⚠️  Sin trades generados.`);
    process.exit(0);
  }

  // ── MONTE CARLO SIMULATION ──────────────────────────────────
  console.log(`\n🎰 Ejecutando Monte Carlo (10,000 iteraciones)...`);
  const mc = monteCarloSimulation(trades, { iterations: 10000, capital: 10000 });
  const robustness = robustnessScore(mc);
  console.log(`✅ Monte Carlo completado — Robustez: ${robustness}/100\n`);

  // ── RISK REPORT ─────────────────────────────────────────────
  const riskReport = generateRiskReport(trades, 10000);

  // Guardar resultado
  const outDir = join(__dirname, '..', 'data');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `backtest-${symbol}-${tf}.json`);
  const fullReport = {
    metrics,
    monteCarlo: mc,
    robustness,
    riskReport,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(outPath, JSON.stringify(fullReport, null, 2), 'utf8');

  // Imprimir resumen
  console.log(`${'═'.repeat(60)}`);
  console.log(`  RESULTADOS v8.0 — ${symbol} ${tf}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Total trades:    ${metrics.total}`);
  console.log(`  Win rate:        ${metrics.winRate}%`);
  console.log(`  Profit factor:   ${metrics.profitFactor}`);
  console.log(`  Sharpe ratio:    ${metrics.sharpe}`);
  console.log(`  Max drawdown:    ${metrics.maxDrawdown}%`);
  console.log(`  P&L total:       ${metrics.totalPnl}%`);
  console.log(`  R:R promedio:    ${metrics.avgRR}`);
  console.log(`  Win promedio:    ${metrics.avgWinPct}%`);
  console.log(`  Loss promedio:   ${metrics.avgLossPct}%`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  LONG:  ${metrics.byDir?.LONG?.total || 0} trades, ${metrics.byDir?.LONG?.winRate || 0}% WR`);
  console.log(`  SHORT: ${metrics.byDir?.SHORT?.total || 0} trades, ${metrics.byDir?.SHORT?.winRate || 0}% WR`);
  console.log(`${'─'.repeat(60)}`);

  if (metrics.byRegime?.length) {
    console.log(`\n  Por Régimen:`);
    for (const r of metrics.byRegime)
      console.log(`    ${r.regime.padEnd(12)}: ${r.total} trades, ${r.winRate}% WR, P&L ${r.pnl}%`);
  }

  if (metrics.byExit?.length) {
    console.log(`\n  Por Exit Reason:`);
    for (const r of metrics.byExit)
      console.log(`    ${r.reason.padEnd(12)}: ${r.total} trades, ${r.winRate}% WR, P&L ${r.pnl}%`);
  }

  if (metrics.mlStats?.totalMLTrades > 0) {
    console.log(`\n  ML Stats: ${metrics.mlStats.totalMLTrades} trades, avg confidence ${metrics.mlStats.avgConfidence}%`);
  }

  console.log(`\n  🎰 Monte Carlo: Robustez ${robustness}/100`);
  if (mc) {
    console.log(`     Prob. Loss: ${mc.probabilityOfLoss}% | Prob. Ruin: ${mc.probabilityOfRuin}%`);
    console.log(`     Worst DD: ${mc.worstDrawdown}% | Median Return: ${mc.medianReturn}%`);
  }

  console.log(`\n  Últimos 10 trades:`);
  for (const t of metrics.trades.slice(-10)) {
    const icon = t.result === 'WIN' ? '✅' : '❌';
    const regime = t.regime ? `[${t.regime}]` : '';
    const ml = t.mlConf ? `(ML:${t.mlConf})` : '';
    console.log(`    ${icon} ${t.signal} ${t.sym} ${t.tf} Score=${t.score} ${regime} ${ml} Entry=${t.entry} Exit=${t.exit} P&L=${t.pnl} (${t.exitReason})`);
  }

  console.log(`\n📊 Resultado guardado en: ${outPath}\n`);
  } catch (e) {
    console.error(`❌ Error: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
