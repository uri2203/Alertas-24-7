// ═══════════════════════════════════════════════════════════════
//  engine/portfolio.js  —  Portfolio Risk Management v8.0
//  Riesgo de portafolio, exposición total, correlación entre posiciones
//  "Un profesional protege su capital ANTES de buscar ganancias"
// ═══════════════════════════════════════════════════════════════

// ── ESTADO DEL PORTAFOLIO ──────────────────────────────────────
const portfolio = {
  positions: new Map(),     // sym -> { direction, size, entry, correlation }
  dailyPnL: 0,
  dailyTrades: 0,
  dailyWins: 0,
  dailyLosses: 0,
  consecutiveLosses: 0,
  maxDrawdownDay: 0,
  peakEquity: 0,
  currentEquity: 10000,
  exposureByDirection: { LONG: 0, SHORT: 0 },
  correlationPenalties: [],
};

// ── CORRELACIONES ENTRE CRYPTOS ─────────────────────────────────
// Correlaciones típicas (se actualizan con datos reales)
const CORRELATION_MATRIX = {
  'BTCUSDT-ETHUSDT': 0.85,
  'BTCUSDT-SOLUSDT': 0.75,
  'BTCUSDT-BNBUSDT': 0.70,
  'BTCUSDT-XRPUSDT': 0.60,
  'BTCUSDT-ADAUSDT': 0.65,
  'ETHUSDT-SOLUSDT': 0.80,
  'ETHUSDT-BNBUSDT': 0.65,
  'ETHUSDT-XRPUSDT': 0.55,
  'SOLUSDT-BNBUSDT': 0.60,
};

// ── CONFIGURACIÓN DE RIESGO ────────────────────────────────────
const CONFIG = {
  maxExposurePct: 10,          // Máximo 10% exposición por dirección
  maxCorrelatedExposure: 15,   // Máximo 15% en cryptos correlacionadas
  maxDailyLossPct: 3,          // Máximo 3% pérdida diaria
  maxConsecutiveLosses: 3,     // Máximo 3 pérdidas seguidas → pausa
  pauseAfterConsecutiveMs: 2 * 60 * 60 * 1000, // 2 horas de pausa
  maxDailyTrades: 10,          // Máximo 10 trades por día
  correlationThreshold: 0.7,   // Correlación >0.7 = misma dirección
};

// ── CALCULAR EXPOSICIÓN ────────────────────────────────────────
export function calculateExposure(sym, direction, size, entry) {
  const currentPrice = entry; // En producción, usar precio actual
  const notionalValue = size * currentPrice;
  const exposurePct = (notionalValue / portfolio.currentEquity) * 100;

  return {
    sym,
    direction,
    notionalValue: +notionalValue.toFixed(2),
    exposurePct: +exposurePct.toFixed(2),
    currentTotal: portfolio.exposureByDirection[direction] + exposurePct,
  };
}

// ── VERIFICAR RIESGO DE PORTAFOLIO ─────────────────────────────
export function checkPortfolioRisk(sym, direction, size, entry) {
  const risks = [];
  let allowed = true;

  // 1. Exposición por dirección
  const exposure = calculateExposure(sym, direction, size, entry);
  const newTotal = portfolio.exposureByDirection[direction] + exposure.exposurePct;
  if (newTotal > CONFIG.maxExposurePct) {
    risks.push({
      type: 'EXPOSURE_LIMIT',
      message: `Exposición ${direction} sería ${newTotal.toFixed(1)}% (máx ${CONFIG.maxExposurePct}%)`,
      severity: 'HIGH',
    });
    allowed = false;
  }

  // 2. Correlación con posiciones abiertas
  for (const [openSym, pos] of portfolio.positions) {
    if (openSym === sym) continue;
    const corrKey = [sym, openSym].sort().join('-');
    const correlation = CORRELATION_MATRIX[corrKey] || 0;

    if (correlation >= CONFIG.correlationThreshold && pos.direction === direction) {
      const corrExposure = exposure.exposurePct + (pos.size * pos.entry / portfolio.currentEquity * 100);
      if (corrExposure > CONFIG.maxCorrelatedExposure) {
        risks.push({
          type: 'CORRELATED_EXPOSURE',
          message: `Correlación ${correlation.toFixed(2)} con ${openSym}. Exposición combinada: ${corrExposure.toFixed(1)}%`,
          severity: 'HIGH',
        });
        allowed = false;
      }
    }
  }

  // 3. Pérdidas diarias
  const dailyLossPct = Math.abs(Math.min(0, portfolio.dailyPnL) / portfolio.currentEquity * 100);
  if (dailyLossPct >= CONFIG.maxDailyLossPct) {
    risks.push({
      type: 'DAILY_LOSS_LIMIT',
      message: `Pérdida diaria: ${dailyLossPct.toFixed(1)}% (máx ${CONFIG.maxDailyLossPct}%)`,
      severity: 'CRITICAL',
    });
    allowed = false;
  }

  // 4. Pérdidas consecutivas
  if (portfolio.consecutiveLosses >= CONFIG.maxConsecutiveLosses) {
    risks.push({
      type: 'CONSECUTIVE_LOSSES',
      message: `${portfolio.consecutiveLosses} pérdidas consecutivas (máx ${CONFIG.maxConsecutiveLosses})`,
      severity: 'CRITICAL',
    });
    allowed = false;
  }

  // 5. Límite de trades diarios
  if (portfolio.dailyTrades >= CONFIG.maxDailyTrades) {
    risks.push({
      type: 'DAILY_TRADE_LIMIT',
      message: `${portfolio.dailyTrades} trades hoy (máx ${CONFIG.maxDailyTrades})`,
      severity: 'MEDIUM',
    });
    allowed = false;
  }

  return {
    allowed,
    risks,
    exposure,
    currentExposure: { ...portfolio.exposureByDirection },
  };
}

// ── REGISTRAR POSICIÓN ABIERTA ─────────────────────────────────
export function registerPosition(sym, direction, size, entry) {
  portfolio.positions.set(sym, { direction, size, entry, openTime: Date.now() });
  portfolio.exposureByDirection[direction] += size * entry / portfolio.currentEquity * 100;
  portfolio.dailyTrades++;
}

// ── REGISTRAR CIERRE DE POSICIÓN ───────────────────────────────
export function registerPositionClose(sym, exitPrice, pnl) {
  const pos = portfolio.positions.get(sym);
  if (!pos) return null;

  const pnlPct = (pnl / portfolio.currentEquity) * 100;
  portfolio.dailyPnL += pnlPct;
  portfolio.currentEquity += pnl;

  // Actualizar exposición
  const posExposure = pos.size * pos.entry / portfolio.currentEquity * 100;
  portfolio.exposureByDirection[pos.direction] = Math.max(0,
    portfolio.exposureByDirection[pos.direction] - posExposure);

  // Actualizar streaks
  if (pnl >= 0) {
    portfolio.dailyWins++;
    portfolio.consecutiveLosses = 0;
  } else {
    portfolio.dailyLosses++;
    portfolio.consecutiveLosses++;
  }

  // Actualizar drawdown
  if (portfolio.currentEquity > portfolio.peakEquity) {
    portfolio.peakEquity = portfolio.currentEquity;
  }
  const drawdown = (portfolio.peakEquity - portfolio.currentEquity) / portfolio.peakEquity * 100;
  portfolio.maxDrawdownDay = Math.max(portfolio.maxDrawdownDay, drawdown);

  portfolio.positions.delete(sym);

  return {
    pnlPct: +pnlPct.toFixed(2),
    dailyPnL: +portfolio.dailyPnL.toFixed(2),
    consecutiveLosses: portfolio.consecutiveLosses,
    drawdown: +drawdown.toFixed(2),
  };
}

// ── VERIFICAR EMERGENCY STOP ───────────────────────────────────
export function checkEmergencyStop() {
  const now = Date.now();
  const reasons = [];

  // Pérdidas consecutivas
  if (portfolio.consecutiveLosses >= CONFIG.maxConsecutiveLosses) {
    reasons.push({
      type: 'CONSECUTIVE_LOSSES',
      message: `${portfolio.consecutiveLosses} pérdidas seguidas`,
      pauseUntil: now + CONFIG.pauseAfterConsecutiveMs,
    });
  }

  // Drawdown diario excesivo
  const dailyLossPct = Math.abs(Math.min(0, portfolio.dailyPnL));
  if (dailyLossPct >= CONFIG.maxDailyLossPct) {
    reasons.push({
      type: 'DAILY_DRAWDOWN',
      message: `Drawdown del día: ${dailyLossPct.toFixed(1)}%`,
      pauseUntil: now + (4 * 60 * 60 * 1000), // 4 horas
    });
  }

  return {
    shouldStop: reasons.length > 0,
    reasons,
    portfolio: getPortfolioSummary(),
  };
}

// ── RESUMEN DEL PORTAFOLIO ─────────────────────────────────────
export function getPortfolioSummary() {
  const openPositions = [];
  for (const [sym, pos] of portfolio.positions) {
    openPositions.push({ sym, ...pos });
  }

  return {
    openPositions: openPositions.length,
    exposureByDirection: { ...portfolio.exposureByDirection },
    totalExposure: portfolio.exposureByDirection.LONG + portfolio.exposureByDirection.SHORT,
    dailyPnL: +portfolio.dailyPnL.toFixed(2),
    dailyTrades: portfolio.dailyTrades,
    dailyWinRate: portfolio.dailyTrades > 0
      ? +((portfolio.dailyWins / portfolio.dailyTrades) * 100).toFixed(1)
      : 0,
    consecutiveLosses: portfolio.consecutiveLosses,
    maxDrawdownDay: +portfolio.maxDrawdownDay.toFixed(2),
    currentEquity: +portfolio.currentEquity.toFixed(2),
    positions: openPositions,
  };
}

// ── RESET DIARIO ───────────────────────────────────────────────
export function resetDaily() {
  portfolio.dailyPnL = 0;
  portfolio.dailyTrades = 0;
  portfolio.dailyWins = 0;
  portfolio.dailyLosses = 0;
  portfolio.maxDrawdownDay = 0;
}

// ── RESET COMPLETO ─────────────────────────────────────────────
export function resetPortfolio() {
  portfolio.positions.clear();
  portfolio.dailyPnL = 0;
  portfolio.dailyTrades = 0;
  portfolio.dailyWins = 0;
  portfolio.dailyLosses = 0;
  portfolio.consecutiveLosses = 0;
  portfolio.maxDrawdownDay = 0;
  portfolio.peakEquity = portfolio.currentEquity;
  portfolio.exposureByDirection = { LONG: 0, SHORT: 0 };
  portfolio.correlationPenalties = [];
}
