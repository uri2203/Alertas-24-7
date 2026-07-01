// ═══════════════════════════════════════════════════════════════
//  engine/agent.js  —  Trading Dashboard PRO v8.0 HUNTER
//  RL Agent: "Tiburón que come tiburones"
//  Q-Learning con estado expandido + reward agresivo + sizing
//  Pure math — no I/O, fully testable
// ═══════════════════════════════════════════════════════════════

import { ema, calcRSI, calcMACD, calcADX, calcATR, calcOBV } from './signals.js';
import { detectRegime } from './regime.js';
import { analyzeStructure } from './structure.js';

// ── ESTADO DEL AGENTE ───────────────────────────────────────────
// 15 features binarias → 2^15 = 32768 estados posibles
// Más estados = más memoria = más precisión
const NUM_STATES = 32768;
const ACTIONS = [0, 1];  // 0=skip, 1=trade

// ── Q-TABLE ─────────────────────────────────────────────────────
let qTable = new Float64Array(NUM_STATES * ACTIONS.length);
let episodeCount = 0;
let totalReward = 0;
let winHistory = [];

// ── HIPERPARAMETROS — MODO HUNTER ──────────────────────────────
// Recompensas ASIMÉTRICAS agresivas:
//   - Ganar grande = recompensa ENORME
//   - Skip oportunidad = penalización FUERTE
//   - Perder = penalización moderada (el mercado es duro)
const PARAMS = {
  learningRate: 0.12,      // Aprende rápido
  discountFactor: 0.95,    // Valora el futuro
  epsilonStart: 0.35,      // Exploración alta al inicio
  epsilonMin: 0.03,        // Exploración mínima (casi siempre explota)
  epsilonDecay: 0.993,     // Decay más lento (más exploración inicial)

  // ── REWARDS HUNTER ──────────────────────────────────────────
  rewardWin:        2.0,   // Ganar = recompensa fuerte
  rewardWinBig:     5.0,   // Ganar >3% = recompensa ENORME
  rewardWinHuge:    8.0,   // Ganar >5% = recompensa ÉPICA
  rewardLoss:      -2.0,   // Perder = penalización fuerte
  rewardLossBig:   -4.0,   // Perder >3% = penalización severa
  rewardSkip:       0.0,   // Skip neutral (sin recompensa)
  rewardSkipMissed: -3.0,  // Skip y el trade ganó = PENALIZACIÓN FUERTE
  rewardGoodSkip:   1.5,   // Skip y el trade perdió = BIEN HECHO

  // ── SIZING ──────────────────────────────────────────────────
  sizeMultiplierHigh: 2.0,   // Confidence >80% = 2x posición
  sizeMultiplierMax:  3.0,   // Confidence >90% = 3x posición
  sizeMultiplierLow:  0.5,   // Confidence <50% = media posición
};

// ── FEATURE EXTRACTION → ESTADO EXPANDIDO (15 features) ────────
// Más features = más contexto = mejores decisiones
export function marketToState(candles) {
  if (!candles || candles.length < 200) return 0;

  const price = candles[candles.length - 1].close;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const vols = candles.map(c => c.vol);

  const features = [];

  // ═══ INDICADORES CLÁSICOS (F1-F8) ══════════════════════════
  // F1: Precio vs EMA50
  const ema50 = ema(closes, 50);
  features.push(ema50[closes.length - 1] && price > ema50[closes.length - 1] ? 1 : 0);

  // F2: Precio vs EMA200
  const ema200 = ema(closes, 200);
  features.push(ema200[closes.length - 1] && price > ema200[closes.length - 1] ? 1 : 0);

  // F3: RSI > 50 (momentum alcista)
  const rsi = calcRSI(candles, 14);
  features.push(rsi && rsi.value > 50 ? 1 : 0);

  // F4: RSI extremo (>70 o <30) — zona de reversión
  features.push(rsi && (rsi.value > 70 || rsi.value < 30) ? 1 : 0);

  // F5: MACD positivo (dirección)
  const macd = calcMACD(candles);
  features.push(macd && macd.dir === 'up' ? 1 : 0);

  // F6: ADX trending (>25)
  const adx = calcADX(candles);
  features.push(adx && adx.trending ? 1 : 0);

  // F7: Volumen spike (>1.5x promedio)
  const recentVol = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avgVol = vols.slice(-50).reduce((a, b) => a + b, 0) / 50;
  features.push(recentVol > avgVol * 1.5 ? 1 : 0);

  // F8: Régimen trending
  const regime = detectRegime(candles);
  features.push(regime && regime.regime === 'trending' ? 1 : 0);

  // ═══ ESTRUCTURA DE MERCADO (F9-F12) ═════════════════════════
  // F9: Break of Structure detectado
  const structure = analyzeStructure(candles);
  features.push(structure && structure.bos ? 1 : 0);

  // F10: Order Block cercano (<2% del precio)
  let obNear = false;
  if (structure && structure.blocks) {
    for (const block of structure.blocks) {
      const dist = Math.abs(price - block.price) / price;
      if (dist < 0.02) { obNear = true; break; }
    }
  }
  features.push(obNear ? 1 : 0);

  // F11: Fair Value Gap (liquidity gap)
  let fvgExists = false;
  if (structure && structure.fvg) {
    for (const gap of structure.fvg) {
      if (price >= gap.low && price <= gap.high) { fvgExists = true; break; }
    }
  }
  features.push(fvgExists ? 1 : 0);

  // F12: Liquidity sweep (precio tocó zona de liquidez)
  let liqSweep = false;
  if (structure && structure.liquidity) {
    const recentHigh = Math.max(...highs.slice(-20));
    const recentLow = Math.min(...lows.slice(-20));
    if (price >= recentHigh * 0.998 || price <= recentLow * 1.002) {
      liqSweep = true;
    }
  }
  features.push(liqSweep ? 1 : 0);

  // ═══ MOMENTUM Y VOLATILIDAD (F13-F15) ═══════════════════════
  // F13: Momentum acelerando (pendiente positiva de los últimos 5 closes)
  const mom5 = closes.length >= 6
    ? (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]
    : 0;
  const mom5Prev = closes.length >= 11
    ? (closes[closes.length - 6] - closes[closes.length - 11]) / closes[closes.length - 11]
    : 0;
  features.push(mom5 > mom5Prev && mom5 > 0 ? 1 : 0);

  // F14: ATR elevado (volatilidad = oportunidad para tiburones)
  const atr = calcATR(candles, 14);
  const atrPct = atr && price ? atr / price : 0;
  features.push(atrPct > 0.025 ? 1 : 0);

  // F15: Precio en zona de soporte/resistencia (últimos 50 velas)
  const recent50High = Math.max(...highs.slice(-50));
  const recent50Low = Math.min(...lows.slice(-50));
  const range = recent50High - recent50Low;
  const position = (price - recent50Low) / (range || 1);
  features.push(position < 0.2 || position > 0.8 ? 1 : 0); // Bordes = zona S/R

  // Convertir vector binario a número de estado
  let state = 0;
  for (let i = 0; i < features.length; i++) {
    state += (features[i] > 0.5 ? 1 : 0) * Math.pow(2, i);
  }
  return Math.min(state, NUM_STATES - 1);
}

// ── CONVICTION SIZING — EL AGENTE DECIDE CUÁNTO APOSTAR ────────
// Confidence alta = posición grande (el tiburón ataca fuerte)
export function convictionSize(confidence) {
  if (confidence >= 0.90) return { multiplier: PARAMS.sizeMultiplierMax, label: 'MAX_CONVICTION' };
  if (confidence >= 0.80) return { multiplier: PARAMS.sizeMultiplierHigh, label: 'HIGH_CONVICTION' };
  if (confidence >= 0.60) return { multiplier: 1.0, label: 'NORMAL' };
  if (confidence >= 0.50) return { multiplier: PARAMS.sizeMultiplierLow, label: 'LOW_CONVICTION' };
  return { multiplier: 0, label: 'SKIP' }; // Confidence muy baja = no operar
}

// ── Q-LEARNING: ELEGIR ACCION ───────────────────────────────────
export function chooseAction(state, epsilon) {
  if (Math.random() < epsilon) {
    return Math.random() < 0.4 ? 0 : 1; // Sesgo hacia TRADE (40% skip, 60% trade)
  }
  const qSkip = qTable[state * ACTIONS.length + 0];
  const qTrade = qTable[state * ACTIONS.length + 1];
  return qTrade >= qSkip ? 1 : 0;
}

// ── Q-LEARNING: ACTUALIZAR ──────────────────────────────────────
export function updateQ(state, action, reward, nextState) {
  const idx = state * ACTIONS.length + action;
  const nextMax = Math.max(
    qTable[nextState * ACTIONS.length + 0],
    qTable[nextState * ACTIONS.length + 1]
  );
  qTable[idx] = qTable[idx] + PARAMS.learningRate *
    (reward + PARAMS.discountFactor * nextMax - qTable[idx]);
}

// ── CALCULAR RECOMPENSA — MODO HUNTER ──────────────────────────
// Recompensas agresivas: ganar grande = ÉPICO, perder = doloroso
export function calcReward(won, pnl, action) {
  if (action === 0) return PARAMS.rewardSkip; // Skip = neutral

  const absPnl = Math.abs(pnl);

  if (won) {
    if (absPnl >= 0.05) return PARAMS.rewardWinHuge;  // >5% = ÉPICO
    if (absPnl >= 0.03) return PARAMS.rewardWinBig;   // >3% = grande
    return PARAMS.rewardWin * (1 + absPnl * 5);        // Ganar normal
  } else {
    if (absPnl >= 0.03) return PARAMS.rewardLossBig;  // >3% pérdida = severo
    return PARAMS.rewardLoss * (1 + absPnl * 3);       // Pérdida normal
  }
}

// ── REWARD POR SKIP (el mercado reveló la verdad) ──────────────
export function calcSkipReward(tradeWon, pnl) {
  if (!tradeWon) {
    return PARAMS.rewardGoodSkip;   // Skip correcto: evitó pérdida
  }
  return PARAMS.rewardSkipMissed;   // Skip incorrecto: perdió ganancia
}

// ── ENTRENAR CON HISTORIAL — MODO HUNTER ───────────────────────
// Entrenamiento agresivo: más episodes, reward asimétrico, focus en catches
export function trainFromHistory(trades, candlesBySymTf) {
  if (!trades || trades.length === 0) return;

  let epsilon = PARAMS.epsilonStart;
  let correctSkips = 0, correctTrades = 0, missedTrades = 0, totalDecisions = 0;
  let bigWins = 0, bigLosses = 0;

  // 150 episodes (más que antes para更好 aprendizaje)
  for (let ep = 0; ep < 150; ep++) {
    let epReward = 0;

    for (const trade of trades) {
      const key = `${trade.sym}-${trade.tf}`;
      const candles = candlesBySymTf[key];
      if (!candles || candles.length < 200) continue;

      const entryIdx = candles.findIndex(c => c.time >= trade.entryTime);
      if (entryIdx < 200) continue;

      const state = marketToState(candles.slice(0, entryIdx + 1));
      const action = chooseAction(state, epsilon);

      const won = trade.result === 'WIN';
      const pnl = trade.pnl || 0;

      let reward;
      if (action === 0) {
        // AGENTE DECIDIÓ SKIP
        reward = calcSkipReward(won, pnl);
        if (!won) correctSkips++;
        else missedTrades++;
      } else {
        // AGENTE DECIDIÓ TRADE
        reward = calcReward(won, pnl, 1);
        if (won) {
          correctTrades++;
          if (Math.abs(pnl) >= 0.03) bigWins++;
        } else {
          if (Math.abs(pnl) >= 0.03) bigLosses++;
        }
      }

      totalDecisions++;
      epReward += reward;

      const nextState = marketToState(candles.slice(0, Math.min(entryIdx + 50, candles.length)));
      updateQ(state, action, reward, nextState);
    }

    epsilon = Math.max(PARAMS.epsilonMin, epsilon * PARAMS.epsilonDecay);
    episodeCount++;
    totalReward += epReward;
    winHistory.push(epReward);
  }

  const skipAccuracy = totalDecisions > 0 ? (correctSkips / Math.max(1, totalDecisions) * 100) : 0;
  const tradeAccuracy = totalDecisions > 0 ? (correctTrades / Math.max(1, totalDecisions) * 100) : 0;

  return {
    episodes: episodeCount,
    avgReward: episodeCount > 0 ? +(totalReward / episodeCount).toFixed(2) : 0,
    skipAccuracy: +skipAccuracy.toFixed(1),
    tradeAccuracy: +tradeAccuracy.toFixed(1),
    missedTrades,
    bigWins,
    bigLosses,
    epsilon: +epsilon.toFixed(3),
    statesExplored: getExploredStates(),
    statesTotal: NUM_STATES,
  };
}

// ── ENTRENAR EN TRADES GANADORES REALES (+3%+) ─────────────────
// "El tiburón aprende de sus presas favoritas"
export function trainOnWinners(winningTrades, candlesBySymTf) {
  if (!winningTrades || winningTrades.length === 0) return null;

  let trained = 0;
  // 50 episodes enfocados solo en ganar
  for (let ep = 0; ep < 50; ep++) {
    for (const trade of winningTrades) {
      const key = `${trade.sym}-${trade.tf}`;
      const candles = candlesBySymTf[key];
      if (!candles || candles.length < 200) continue;

      const entryIdx = candles.findIndex(c => c.time >= trade.entryTime);
      if (entryIdx < 200) continue;

      const state = marketToState(candles.slice(0, entryIdx + 1));

      // FORZAR: en entrenamiento de winners, el agente siempre elige TRADE
      // para aprender qué se siente ganar
      const action = 1;
      const won = trade.result === 'WIN';
      const pnl = trade.pnl || 0;

      const reward = calcReward(won, pnl, 1);
      const nextState = marketToState(candles.slice(0, Math.min(entryIdx + 50, candles.length)));

      updateQ(state, action, reward, nextState);
      trained++;
    }
  }

  return { trainedOn: trained, winners: winningTrades.length };
}

// ── PREDICCIÓN DEL AGENTE — CON CONVICTION SIZING ──────────────
export function agentPredict(candles) {
  if (!candles || candles.length < 200) {
    return {
      action: 'TRADE', confidence: 0.5, state: 0,
      reason: 'datos insuficientes', sizing: { multiplier: 1.0, label: 'NORMAL' },
    };
  }

  const state = marketToState(candles);
  const qSkip = qTable[state * ACTIONS.length + 0];
  const qTrade = qTable[state * ACTIONS.length + 1];
  const action = qTrade >= qSkip ? 1 : 0;

  // Confidence: normalizada con softmax-like
  const diff = qTrade - qSkip;
  const maxQ = Math.max(Math.abs(qTrade), Math.abs(qSkip), 0.01);
  const confidence = 1 / (1 + Math.exp(-diff / maxQ * 3)); // Sigmoid

  // Conviction sizing
  const sizing = action === 1 ? convictionSize(confidence) : { multiplier: 0, label: 'SKIP' };

  // Risk level
  const riskLevel = confidence >= 0.85 ? 'AGGRESSIVE'
    : confidence >= 0.65 ? 'NORMAL'
    : confidence >= 0.50 ? 'CONSERVATIVE'
    : 'AVOID';

  return {
    action: action === 1 ? 'TRADE' : 'SKIP',
    confidence: +confidence.toFixed(3),
    state,
    qTrade: +qTrade.toFixed(4),
    qSkip: +qSkip.toFixed(4),
    sizing,
    riskLevel,
    reason: action === 1
      ? `HUNTER APROBA (${riskLevel})`
      : `SKIP (${riskLevel})`,
  };
}

// ── STATISTICS ──────────────────────────────────────────────────
function getExploredStates() {
  let explored = 0;
  for (let i = 0; i < NUM_STATES; i++) {
    if (qTable[i * 2] !== 0 || qTable[i * 2 + 1] !== 0) explored++;
  }
  return explored;
}

export function getAgentStats() {
  const recentRewards = winHistory.slice(-50);
  const avgRecent = recentRewards.length > 0
    ? recentRewards.reduce((a, b) => a + b, 0) / recentRewards.length
    : 0;

  const explored = getExploredStates();

  return {
    episodes: episodeCount,
    totalReward: +totalReward.toFixed(2),
    avgRecentReward: +avgRecent.toFixed(2),
    statesExplored: explored,
    statesTotal: NUM_STATES,
    explorationPct: +(explored / NUM_STATES * 100).toFixed(1),
    epsilon: +(Math.max(PARAMS.epsilonMin, PARAMS.epsilonStart * Math.pow(PARAMS.epsilonDecay, episodeCount))).toFixed(3),
    mode: 'HUNTER v8.0',
    features: 15,
    maxStates: NUM_STATES,
  };
}

// ── EXPORTAR/IMPORTAR Q-TABLE ───────────────────────────────────
export function exportQTable() {
  return {
    qTable: Array.from(qTable),
    episodeCount,
    totalReward,
    winHistory: winHistory.slice(-100),
    params: PARAMS,
    version: 'HUNTER-8.0',
    features: 15,
    maxStates: NUM_STATES,
  };
}

export function importQTable(data) {
  if (data.qTable) qTable = new Float64Array(data.qTable);
  if (data.episodeCount) episodeCount = data.episodeCount;
  if (data.totalReward) totalReward = data.totalReward;
  if (data.winHistory) winHistory = data.winHistory;
}

// ── RESET ───────────────────────────────────────────────────────
export function resetAgent() {
  qTable = new Float64Array(NUM_STATES * ACTIONS.length);
  episodeCount = 0;
  totalReward = 0;
  winHistory = [];
}
