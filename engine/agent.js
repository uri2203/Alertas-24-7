// ═══════════════════════════════════════════════════════════════
//  engine/agent.js  —  Trading Dashboard PRO v8.0
//  RL Agent: aprende del historial para decidir si operar o NO
//  Algoritmo: Q-Learning discreto con epsilon-greedy
//  Pure math — no I/O, fully testable
// ═══════════════════════════════════════════════════════════════

import { ema, calcRSI, calcMACD, calcADX, calcATR, calcOBV } from './signals.js';
import { detectRegime } from './regime.js';

// ── ESTADO DEL AGENTE ───────────────────────────────────────────
// Cada estado es un vector discreto de features del mercado
// El agente decide: TRADE (1) o SKIP (0)
const NUM_STATES = 1024; // 2^10 features binarias
const ACTIONS = [0, 1];  // 0=skip, 1=trade

// ── Q-TABLE ─────────────────────────────────────────────────────
// Almacena valor de cada (estado, accion)
let qTable = new Float64Array(NUM_STATES * ACTIONS.length);
let episodeCount = 0;
let totalReward = 0;
let winHistory = [];

// ── HIPERPARAMETROS ─────────────────────────────────────────────
const PARAMS = {
  learningRate: 0.1,     // alpha: qué tan rápido aprende
  discountFactor: 0.95,  // gamma: valor del futuro
  epsilonStart: 0.3,     // exploración inicial (30%)
  epsilonMin: 0.05,      // exploración mínima (5%)
  epsilonDecay: 0.995,   // decay por episode
  rewardWin: 1.0,        // recompensa por acertar
  rewardLoss: -1.5,      // penalización por fallar (asimétrica)
  rewardSkip: 0.01,      // recompensa pequeña por no operar (evita overtrading)
};

// ── FEATURE EXTRACTION → ESTADO DISCRETO ────────────────────────
// Convierte el estado del mercado en un número de estado discreto (0-1023)
export function marketToState(candles) {
  if (!candles || candles.length < 100) return 0;

  const price = candles[candles.length - 1].close;
  const closes = candles.map(c => c.close);

  // 10 features binarias (cada una 0 o 1) → 2^10 = 1024 estados
  const features = [];

  // F1: Precio vs EMA50 (arriba/abajo)
  const ema50 = ema(closes, 50);
  features.push(ema50[closes.length - 1] && price > ema50[closes.length - 1] ? 1 : 0);

  // F2: Precio vs EMA200 (arriba/abajo)
  const ema200 = ema(closes, 200);
  features.push(ema200[closes.length - 1] && price > ema200[closes.length - 1] ? 1 : 0);

  // F3: RSI > 50
  const rsi = calcRSI(candles, 14);
  features.push(rsi && rsi.value > 50 ? 1 : 0);

  // F4: RSI > 70 (sobrecompra) o < 30 (sobreventa)
  features.push(rsi && (rsi.value > 70 || rsi.value < 30) ? 1 : 0);

  // F5: MACD positivo
  const macd = calcMACD(candles);
  features.push(macd && macd.dir === 'up' ? 1 : 0);

  // F6: ADX trending (>25)
  const adx = calcADX(candles);
  features.push(adx && adx.trending ? 1 : 0);

  // F7: Volumen arriba del promedio
  const recentVol = candles.slice(-10).reduce((a, c) => a + c.vol, 0) / 10;
  const prevVol = candles.slice(-20, -10).reduce((a, c) => a + c.vol, 0) / 10;
  features.push(recentVol > prevVol * 1.2 ? 1 : 0);

  // F8: Régimen trending
  const regime = detectRegime(candles);
  features.push(regime && regime.regime === 'trending' ? 1 : 0);

  // F9: Momentum positivo (5 velas)
  const mom5 = closes.length >= 5 ? (price - closes[closes.length - 6]) / closes[closes.length - 6] : 0;
  features.push(mom5 > 0.005 ? 1 : mom5 < -0.005 ? 0 : 0.5);

  // F10: ATR elevado (volatilidad)
  const atr = calcATR(candles, 14);
  const atrPct = atr && price ? atr / price : 0;
  features.push(atrPct > 0.02 ? 1 : 0);

  // Convertir vector binario a número de estado
  let state = 0;
  for (let i = 0; i < features.length; i++) {
    state += (features[i] > 0.5 ? 1 : 0) * Math.pow(2, i);
  }
  return Math.min(state, NUM_STATES - 1);
}

// ── Q-LEARNING: ELEGIR ACCION ───────────────────────────────────
export function chooseAction(state, epsilon) {
  // Epsilon-greedy: con probabilidad epsilon, explorar
  if (Math.random() < epsilon) {
    return Math.random() < 0.5 ? 0 : 1; // Explorar aleatorio
  }
  // Explotar: elegir la acción con mayor Q-valor
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
  // Q(s,a) = Q(s,a) + α * (r + γ * max(Q(s',a')) - Q(s,a))
  qTable[idx] = qTable[idx] + PARAMS.learningRate *
    (reward + PARAMS.discountFactor * nextMax - qTable[idx]);
}

// ── CALCULAR RECOMPENSA ─────────────────────────────────────────
export function calcReward(won, pnl, action) {
  if (action === 0) return PARAMS.rewardSkip; // Skip = recompensa pequeña positiva
  if (won) return PARAMS.rewardWin * (1 + Math.abs(pnl) * 10); // Mayor ganancia = mayor recompensa
  return PARAMS.rewardLoss * (1 + Math.abs(pnl) * 5); // Mayor pérdida = mayor penalización
}

// ── ENTRENAR CON HISTORIAL ──────────────────────────────────────
export function trainFromHistory(trades, candlesBySymTf) {
  if (!trades || trades.length === 0) return;

  let epsilon = PARAMS.epsilonStart;
  let correctSkips = 0, correctTrades = 0, totalDecisions = 0;

  for (let ep = 0; ep < 100; ep++) { // 100 episodes
    let epReward = 0;

    for (const trade of trades) {
      const key = `${trade.sym}-${trade.tf}`;
      const candles = candlesBySymTf[key];
      if (!candles || candles.length < 200) continue;

      // Encontrar el indice de entrada
      const entryIdx = candles.findIndex(c => c.time >= trade.entryTime);
      if (entryIdx < 200) continue;

      // Estado ANTES de la señal
      const state = marketToState(candles.slice(0, entryIdx + 1));

      // El agente decide
      const action = chooseAction(state, epsilon);

      // Resultado real
      const won = trade.result === 'WIN';
      const pnl = trade.pnl || 0;
      const actualAction = 1; // Se operó

      // Recompensa basada en lo que el agente decidió
      let reward;
      if (action === 0) {
        // Agente decidió SKIP
        if (!won) {
          // BIEN: evitó una pérdida
          reward = PARAMS.rewardWin * 2;
          correctSkips++;
        } else {
          // MAL: perdió una ganancia
          reward = PARAMS.rewardLoss;
        }
      } else {
        // Agente decidió TRADE
        reward = calcReward(won, pnl, 1);
        if (won) correctTrades++;
      }

      totalDecisions++;
      epReward += reward;

      // Siguiente estado (después de la señal)
      const nextState = marketToState(candles.slice(0, Math.min(entryIdx + 50, candles.length)));

      // Actualizar Q-table
      updateQ(state, action, reward, nextState);
    }

    // Decay epsilon
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
    epsilon: +epsilon.toFixed(3),
  };
}

// ── PREDICCIÓN DEL AGENTE ───────────────────────────────────────
// Retorna: { action: 'TRADE'|'SKIP', confidence, state }
export function agentPredict(candles) {
  if (!candles || candles.length < 200) {
    return { action: 'TRADE', confidence: 0.5, state: 0, reason: 'datos insuficientes' };
  }

  const state = marketToState(candles);
  const qSkip = qTable[state * ACTIONS.length + 0];
  const qTrade = qTable[state * ACTIONS.length + 1];
  const action = qTrade >= qSkip ? 1 : 0;

  // Confidence: diferencia normalizada entre Q-valores
  const diff = Math.abs(qTrade - qSkip);
  const maxQ = Math.max(Math.abs(qTrade), Math.abs(qSkip), 0.01);
  const confidence = 0.5 + (diff / maxQ) * 0.5;

  return {
    action: action === 1 ? 'TRADE' : 'SKIP',
    confidence: +confidence.toFixed(3),
    state,
    qTrade: +qTrade.toFixed(4),
    qSkip: +qSkip.toFixed(4),
    reason: action === 1 ? 'agente aprueba' : 'agente bloquea',
  };
}

// ── STATISTICS ──────────────────────────────────────────────────
export function getAgentStats() {
  const recentRewards = winHistory.slice(-50);
  const avgRecent = recentRewards.length > 0
    ? recentRewards.reduce((a, b) => a + b, 0) / recentRewards.length
    : 0;

  // Calcular % de estados explorados
  let explored = 0;
  for (let i = 0; i < NUM_STATES; i++) {
    const q0 = qTable[i * 2];
    const q1 = qTable[i * 2 + 1];
    if (q0 !== 0 || q1 !== 0) explored++;
  }

  return {
    episodes: episodeCount,
    totalReward: +totalReward.toFixed(2),
    avgRecentReward: +avgRecent.toFixed(2),
    statesExplored: explored,
    statesTotal: NUM_STATES,
    explorationPct: +(explored / NUM_STATES * 100).toFixed(1),
    epsilon: +(Math.max(PARAMS.epsilonMin, PARAMS.epsilonStart * Math.pow(PARAMS.epsilonDecay, episodeCount))).toFixed(3),
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
