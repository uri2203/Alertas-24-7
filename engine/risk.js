// ═══════════════════════════════════════════════════════════════
//  engine/risk.js  —  Trading Dashboard PRO v8.0
//  Risk Management: Kelly Criterion + Position Sizing + Max DD Stop
//  Pure math — no I/O, fully testable
// ═══════════════════════════════════════════════════════════════

// ── KELLY CRITERION ─────────────────────────────────────────────
// Calcula el % óptimo del capital a arriesgar por trade
// f* = (bp - q) / b
// b = ratio ganancia/pérdida (R:R)
// p = probabilidad de ganar (win rate)
// q = probabilidad de perder (1 - win rate)
// Se usa fractional Kelly (25%) para reducir varianza
export function kellyFraction(winRate, avgWin, avgLoss) {
  if (!winRate || !avgWin || !avgLoss || avgLoss === 0) return 0;
  const b = avgWin / avgLoss;
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  // Fractional Kelly: usar solo 25% del Kelly óptimo para seguridad
  return Math.max(0, Math.min(kelly * 0.25, 0.05));
}

// ── POSITION SIZING ─────────────────────────────────────────────
// Calcula cuánto arriesgar en $ basado en:
// - Capital total
// - Kelly fraction
// - Confidence score del ML
// - Regime del mercado
export function calcPositionSize(capital, kellyFrac, mlConfidence, regime) {
  let basePct = kellyFrac;

  // Ajustar por confianza del ML (0.5 - 1.0)
  if (mlConfidence != null && mlConfidence > 0) {
    basePct *= Math.max(0.5, Math.min(mlConfidence, 1.0));
  }

  // Ajustar por régimen de mercado
  if (regime === 'trending') basePct *= 1.2;      // +20% en tendencia
  else if (regime === 'ranging') basePct *= 0.6;  // -40% en rango
  else if (regime === 'volatile') basePct *= 0.7;  // -30% en volatilidad

  // Límites de seguridad
  basePct = Math.max(0.005, Math.min(basePct, 0.05)); // 0.5% - 5% max

  return {
    riskPct: basePct,
    riskAmount: capital * basePct,
    kellyRaw: kellyFrac,
    adjusted: basePct,
  };
}

// ── STOP LOSS DINÁMICO ──────────────────────────────────────────
// SL basado en ATR + volatilidad actual + distancia a soporte/resistencia
export function calcDynamicSL(entryPrice, signal, atr, fib, regime) {
  if (!atr || atr === 0) return null;

  let atrMult = 2.0;

  // Ajustar multiplicador por régimen
  if (regime === 'trending') atrMult = 2.5;      // Más holgado en tendencia
  else if (regime === 'ranging') atrMult = 1.5;  // Más ajustado en rango
  else if (regime === 'volatile') atrMult = 3.0; // Más holgado en volatilidad

  const isUp = signal === 'LONG';
  const atrSL = isUp ? entryPrice - atr * atrMult : entryPrice + atr * atrMult;

  // Usar el SL más cercano que tenga sentido (mínimo 1 ATR)
  const minDist = atr * 1.0;
  let sl = atrSL;

  if (fib) {
    const fibSL = isUp ? fib.L : fib.H;
    const fibDist = Math.abs(entryPrice - fibSL);
    if (fibDist >= minDist && fibDist <= atr * 4) {
      sl = fibSL; // Usar Fib si está en rango razonable
    }
  }

  // Asegurar distancia mínima
  const dist = Math.abs(entryPrice - sl);
  if (dist < minDist) {
    sl = isUp ? entryPrice - minDist : entryPrice + minDist;
  }

  return sl;
}

// ── TAKE PROFIT DINÁMICO ────────────────────────────────────────
export function calcDynamicTP(entryPrice, sl, signal, fib, regime) {
  const slDist = Math.abs(entryPrice - sl);
  let rrMult = 2.0;

  // Ajustar R:R por régimen
  if (regime === 'trending') rrMult = 2.5;      // Buscar más ganancia en tendencia
  else if (regime === 'ranging') rrMult = 1.5;  // Objetivos más conservadores
  else if (regime === 'volatile') rrMult = 2.0;

  const isUp = signal === 'LONG';
  let t1 = isUp ? entryPrice + slDist * rrMult : entryPrice - slDist * rrMult;
  let t2 = isUp ? entryPrice + slDist * rrMult * 2 : entryPrice - slDist * rrMult * 2;

  // Usar Fib si está mejor ubicado
  if (fib) {
    const fibTP1 = isUp ? fib.r382 : fib.r618;
    const fibTP2 = isUp ? fib.r236 : fib.r786;
    if (isUp && fibTP1 > t1) t1 = fibTP1;
    if (isUp && fibTP2 > t2) t2 = fibTP2;
    if (!isUp && fibTP1 < t1) t1 = fibTP1;
    if (!isUp && fibTP2 < t2) t2 = fibTP2;
  }

  return { t1, t2 };
}

// ── MAX DRAWDOWN STOP ───────────────────────────────────────────
// Si el drawdown total supera el umbral, pausar operaciones
export function checkMaxDrawdown(equity, peakEquity, maxDDPct = 0.15) {
  if (peakEquity <= 0) return { breached: false, dd: 0 };
  const dd = (peakEquity - equity) / peakEquity;
  return {
    breached: dd >= maxDDPct,
    dd,
    ddPct: +(dd * 100).toFixed(2),
    equity,
    peakEquity,
  };
}

// ── TRAILING STOP ───────────────────────────────────────────────
export function calcTrailingStop(entryPrice, currentPrice, signal, atr, trailPct = 0.02) {
  if (!atr || !currentPrice) return null;
  const isUp = signal === 'LONG';

  // Trail basado en ATR (más dinámico que % fijo)
  const trailDist = atr * 1.5;

  if (isUp) {
    const trail = currentPrice - trailDist;
    return trail > entryPrice - atr * 2 ? trail : null; // Solo activar si hay ganancia
  } else {
    const trail = currentPrice + trailDist;
    return trail < entryPrice + atr * 2 ? trail : null;
  }
}

// ── EXPECTANCIA (EDGE) ──────────────────────────────────────────
// Calcula la expectancia por trade: cuánto esperas ganar en promedio
export function calcExpectancy(winRate, avgWin, avgLoss) {
  if (!winRate || !avgWin || !avgLoss) return 0;
  return (winRate * avgWin) - ((1 - winRate) * avgLoss);
}

// ── MAX CONSECUTIVE LOSSES ──────────────────────────────────────
// Estimación teórica de racha máxima de pérdidas
export function maxConsecutiveLosses(trades, confidence = 0.95) {
  if (!trades || trades.length === 0) return 0;
  const losses = trades.filter(t => t.result === 'LOSS').length;
  const wr = 1 - losses / trades.length;
  if (wr >= 1) return 0;
  // Geometric distribution inverse
  const n = Math.ceil(Math.log(1 - confidence) / Math.log(wr));
  return Math.min(n, 50); // Cap at 50
}

// ── RISK REPORT ─────────────────────────────────────────────────
// Genera reporte completo de riesgo para un set de trades
export function generateRiskReport(trades, capital = 10000) {
  if (!trades || trades.length === 0) return null;

  const wins = trades.filter(t => t.result === 'WIN');
  const losses = trades.filter(t => t.result === 'LOSS');
  const wr = wins.length / trades.length;
  const avgWin = wins.length ? wins.reduce((a, t) => a + (t.pnl || 0), 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + (t.pnl || 0), 0) / losses.length) : 0;

  const kelly = kellyFraction(wr, avgWin, avgLoss);
  const expectancy = calcExpectancy(wr, avgWin, avgLoss);
  const maxConsLoss = maxConsecutiveLosses(trades);

  // Simular equity curve
  let equity = capital, peak = capital, maxDD = 0;
  const equityCurve = [capital];
  for (const t of trades) {
    equity *= (1 + (t.pnl || 0));
    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    totalTrades: trades.length,
    winRate: +(wr * 100).toFixed(2),
    avgWin: +(avgWin * 100).toFixed(2),
    avgLoss: +(avgLoss * 100).toFixed(2),
    profitFactor: avgLoss > 0 ? +(avgWin / avgLoss).toFixed(2) : 0,
    expectancy: +(expectancy * 100).toFixed(4),
    kellyFraction: +(kelly * 100).toFixed(2),
    kellyDollar: +(kelly * capital).toFixed(2),
    maxConsecutiveLosses: maxConsLoss,
    maxDrawdown: +(maxDD * 100).toFixed(2),
    finalEquity: +equity.toFixed(2),
    totalReturn: +((equity - capital) / capital * 100).toFixed(2),
    equityCurve,
  };
}
