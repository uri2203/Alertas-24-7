// ═══════════════════════════════════════════════════════════════
//  position.js  —  Position Management v8.0
//  SL breakeven, partial profits, trailing stops, early close
//  "Los profesionales ganan por gestión, no por entradas"
// ═══════════════════════════════════════════════════════════════

// ── ESTADO DE POSICIONES ABIERTAS ────────────────────────────
const positions = new Map(); // sym -> { entry, sl, tp, size, pnl, ... }

// ── CREAR POSICIÓN ───────────────────────────────────────────
export function openPosition(sym, direction, entry, sl, tp, size = 1) {
  const pos = {
    sym,
    direction,      // 'LONG' o 'SHORT'
    entry,
    originalSL: sl,
    sl,
    tp,
    size,
    openTime: Date.now(),
    pnl: 0,
    pnlPct: 0,
    status: 'open',
    breakevenMoved: false,
    partialTaken: false,
    trailActive: false,
    highestPnl: 0,
    managementLog: [],
  };

  positions.set(sym, pos);
  logManagement(sym, 'opened', { entry, sl, tp, direction });
  return pos;
}

// ── CERRAR POSICIÓN ──────────────────────────────────────────
export function closePosition(sym, exitPrice, reason = 'manual') {
  const pos = positions.get(sym);
  if (!pos || pos.status !== 'open') return null;

  pos.exitPrice = exitPrice;
  pos.closeTime = Date.now();
  pos.status = 'closed';
  pos.closeReason = reason;

  // Calcular P&L final
  if (pos.direction === 'LONG') {
    pos.pnl = (exitPrice - pos.entry) / pos.entry * pos.size;
  } else {
    pos.pnl = (pos.entry - exitPrice) / pos.entry * pos.size;
  }
  pos.pnlPct = pos.pnl * 100;

  logManagement(sym, 'closed', { exit: exitPrice, reason, pnl: pos.pnlPct.toFixed(2) + '%' });

  const result = { ...pos };
  positions.delete(sym);
  return result;
}

// ── MOVER SL A BREAKEVEN ─────────────────────────────────────
// Cuando el precio va a favor, mover SL al punto de entrada
// Regla: cuando P&L >= 1% del riesgo original
export function checkBreakeven(sym, currentPrice) {
  const pos = positions.get(sym);
  if (!pos || pos.status !== 'open' || pos.breakevenMoved) return null;

  const riskPct = Math.abs(pos.entry - pos.originalSL) / pos.entry;
  let currentPnlPct;

  if (pos.direction === 'LONG') {
    currentPnlPct = (currentPrice - pos.entry) / pos.entry;
  } else {
    currentPnlPct = (pos.entry - currentPrice) / pos.entry;
  }

  // Si el precio avanzó al menos 1x el riesgo original → mover a breakeven
  if (currentPnlPct >= riskPct * 1) {
    pos.sl = pos.entry; // SL = entrada (breakeven)
    pos.breakevenMoved = true;
    pos.managementLog.push({
      action: 'breakeven',
      time: Date.now(),
      newSL: pos.sl,
      pnlAtMove: (currentPnlPct * 100).toFixed(2) + '%',
    });
    return { action: 'breakeven', newSL: pos.sl };
  }

  return null;
}

// ── TRAILING STOP ────────────────────────────────────────────
// SL sigue al precio con distancia fija (ATR-based)
export function checkTrailingStop(sym, currentPrice, atr) {
  const pos = positions.get(sym);
  if (!pos || pos.status !== 'open') return null;

  // Solo activar trailing después de breakeven
  if (!pos.breakevenMoved) return null;

  const trailDistance = atr * 2; // 2x ATR de distancia

  let newSL;
  if (pos.direction === 'LONG') {
    newSL = currentPrice - trailDistance;
    // Solo mover SL hacia arriba, nunca hacia abajo
    if (newSL > pos.sl) {
      pos.sl = Math.round(newSL * 100) / 100;
      pos.trailActive = true;
      pos.managementLog.push({
        action: 'trailing',
        time: Date.now(),
        newSL: pos.sl,
      });
      return { action: 'trailing', newSL: pos.sl };
    }
  } else {
    newSL = currentPrice + trailDistance;
    if (newSL < pos.sl) {
      pos.sl = Math.round(newSL * 100) / 100;
      pos.trailActive = true;
      pos.managementLog.push({
        action: 'trailing',
        time: Date.now(),
        newSL: pos.sl,
      });
      return { action: 'trailing', newSL: pos.sl };
    }
  }

  return null;
}

// ── PROFITS PARCIALES ────────────────────────────────────────
// Tomar 50% de la posición en el primer target
export function checkPartialProfit(sym, currentPrice, tp1) {
  const pos = positions.get(sym);
  if (!pos || pos.status !== 'open' || pos.partialTaken) return null;
  if (!tp1) return null;

  let reached = false;
  if (pos.direction === 'LONG' && currentPrice >= tp1) reached = true;
  if (pos.direction === 'SHORT' && currentPrice <= tp1) reached = true;

  if (reached) {
    pos.partialTaken = true;
    pos.size = pos.size * 0.5; // Reducir size 50%
    pos.managementLog.push({
      action: 'partial_profit',
      time: Date.now(),
      price: currentPrice,
      sizeReduced: '50%',
      remainingSize: pos.size,
    });
    return { action: 'partial_profit', price: currentPrice, size: pos.size };
  }

  return null;
}

// ── CIERRE ANTICIPADO (CAMBIO DE ESTRUCTURA) ─────────────────
// Si el mercado cambia, cerrar antes del SL
export function checkEarlyClose(sym, currentPrice, structureChanged) {
  const pos = positions.get(sym);
  if (!pos || pos.status !== 'open') return null;

  if (structureChanged) {
    let shouldClose = false;

    // LONG + estructura cambió a bajista = cerrar
    if (pos.direction === 'LONG' && structureChanged === 'bearish') {
      shouldClose = true;
    }
    // SHORT + estructura cambió a alcista = cerrar
    if (pos.direction === 'SHORT' && structureChanged === 'bullish') {
      shouldClose = true;
    }

    if (shouldClose) {
      return closePosition(sym, currentPrice, 'structure_change');
    }
  }

  return null;
}

// ── VERIFICAR SL/TP ──────────────────────────────────────────
export function checkSLTP(sym, currentPrice) {
  const pos = positions.get(sym);
  if (!pos || pos.status !== 'open') return null;

  // Stop Loss
  if (pos.direction === 'LONG' && currentPrice <= pos.sl) {
    return closePosition(sym, pos.sl, 'stop_loss');
  }
  if (pos.direction === 'SHORT' && currentPrice >= pos.sl) {
    return closePosition(sym, pos.sl, 'stop_loss');
  }

  // Take Profit
  if (pos.direction === 'LONG' && currentPrice >= pos.tp) {
    return closePosition(sym, pos.tp, 'take_profit');
  }
  if (pos.direction === 'SHORT' && currentPrice <= pos.tp) {
    return closePosition(sym, pos.tp, 'take_profit');
  }

  return null;
}

// ── LÓGICA DE GESTIÓN COMPLETA ───────────────────────────────
// Ejecutar todos los checks en orden de prioridad
export function managePosition(sym, currentPrice, atr, structureChanged, tp1) {
  const actions = [];

  // 1. Verificar SL/TP primero (prioridad máxima)
  const sltpResult = checkSLTP(sym, currentPrice);
  if (sltpResult) return { closed: true, result: sltpResult, actions };

  // 2. Verificar cierre anticipado por cambio de estructura
  const earlyResult = checkEarlyClose(sym, currentPrice, structureChanged);
  if (earlyResult) return { closed: true, result: earlyResult, actions };

  // 3. Verificar profits parciales
  const partialResult = checkPartialProfit(sym, currentPrice, tp1);
  if (partialResult) actions.push(partialResult);

  // 4. Verificar breakeven
  const beResult = checkBreakeven(sym, currentPrice);
  if (beResult) actions.push(beResult);

  // 5. Verificar trailing stop
  const trailResult = checkTrailingStop(sym, currentPrice, atr);
  if (trailResult) actions.push(trailResult);

  return { closed: false, actions };
}

// ── POSICIONES ABIERTAS ──────────────────────────────────────
export function getOpenPositions() {
  const open = [];
  for (const [sym, pos] of positions) {
    if (pos.status === 'open') open.push({ ...pos });
  }
  return open;
}

// ── LÍMITE DE POSICIONES ─────────────────────────────────────
export function canOpenPosition(maxPositions = 3) {
  const openCount = getOpenPositions().length;
  return {
    canOpen: openCount < maxPositions,
    openCount,
    maxPositions,
    remaining: maxPositions - openCount,
  };
}

// ── LOG DE GESTIÓN ───────────────────────────────────────────
function logManagement(sym, action, data) {
  const pos = positions.get(sym);
  if (pos) {
    pos.managementLog.push({
      action,
      time: Date.now(),
      ...data,
    });
  }
}

// ── ESTADÍSTICAS DE GESTIÓN ──────────────────────────────────
export function getPositionStats() {
  const open = getOpenPositions();
  const totalPnl = open.reduce((a, p) => a + p.pnl, 0);

  return {
    openPositions: open.length,
    totalPnl: Math.round(totalPnl * 10000) / 100,
    positions: open.map(p => ({
      sym: p.sym,
      direction: p.direction,
      entry: p.entry,
      currentSL: p.sl,
      pnl: Math.round(p.pnl * 10000) / 100,
      breakevenMoved: p.breakevenMoved,
      trailActive: p.trailActive,
      partialTaken: p.partialTaken,
    })),
  };
}

// ── CALCULAR TAMAÑO DE POSICIÓN ──────────────────────────────
// Basado en riesgo por trade (% de la cuenta)
export function calculatePositionSize(accountBalance, riskPct, entry, sl) {
  if (!accountBalance || !riskPct || !entry || !sl) return null;

  const riskAmount = accountBalance * (riskPct / 100);
  const distancePct = Math.abs(entry - sl) / entry;
  const positionSize = riskAmount / distancePct;

  return {
    size: Math.round(positionSize * 100) / 100,
    riskAmount: Math.round(riskAmount * 100) / 100,
    distancePct: Math.round(distancePct * 10000) / 100,
    maxLoss: riskAmount,
    riskReward: null, // Se calcula con TP
  };
}

// ── RISK:REWARD CALCULATOR ───────────────────────────────────
export function riskReward(entry, sl, tp) {
  if (!entry || !sl || !tp) return null;

  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const rr = reward / risk;

  return {
    risk: Math.round(risk * 100) / 100,
    reward: Math.round(reward * 100) / 100,
    ratio: Math.round(rr * 100) / 100,
    label: rr >= 3 ? 'excelente' : rr >= 2 ? 'bueno' : rr >= 1.5 ? 'aceptable' : 'malo',
  };
}
