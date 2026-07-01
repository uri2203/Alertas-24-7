// ═══════════════════════════════════════════════════════════════
//  engine/agent.js  —  Trading Dashboard PRO v8.0 ELITE
//  RL Agent: "Tiburón de Élite que caza noticias"
//  Q-Learning con 20 features, 1M+ estados, news rewards
//  Pure math — no I/O, fully testable
// ═══════════════════════════════════════════════════════════════

import { ema, calcRSI, calcMACD, calcADX, calcATR } from './signals.js';
import { detectRegime } from './regime.js';
import { analyzeStructure } from './structure.js';
import { detectNews, NEWS_REWARDS } from './news.js';

// ── ESTADO DEL AGENTE ───────────────────────────────────────────
// 20 features binarias → 2^20 = 1,048,576 estados posibles
// El agente "ve" el mercado completo: estructura + indicadores + noticias
const NUM_STATES = 1048576;
const ACTIONS = [0, 1];  // 0=skip, 1=trade

// ── Q-TABLE ─────────────────────────────────────────────────────
let qTable = new Float64Array(NUM_STATES * ACTIONS.length);
let episodeCount = 0;
let totalReward = 0;
let winHistory = [];

// ── LEARNING STATS — TRACKING DETALLADO ─────────────────────────
let learningStats = {
  totalDecisions: 0,
  tradesDecided: 0,
  skipsDecided: 0,
  correctTrades: 0,
  correctSkips: 0,
  missedTrades: 0,
  bigWins: 0,
  bigLosses: 0,
  newsTrades: 0,
  newsWins: 0,
  fadeTrades: 0,
  fadeWins: 0,
  maxWinStreak: 0,
  maxLoseStreak: 0,
  currentWinStreak: 0,
  currentLoseStreak: 0,
  confidenceHistory: [],
  rewardHistory: [],
  lastDecision: null,
  lastNewsScore: 0,
  trainingHistory: [],
};

// ── HIPERPARAMETROS — MODO ELITE HUNTER ────────────────────────
const PARAMS = {
  learningRate: 0.12,
  discountFactor: 0.95,
  epsilonStart: 0.35,
  epsilonMin: 0.03,
  epsilonDecay: 0.993,

  // ── REWARDS HUNTER ──────────────────────────────────────────
  rewardWin:        2.0,
  rewardWinBig:     5.0,
  rewardWinHuge:    8.0,
  rewardLoss:      -2.0,
  rewardLossBig:   -4.0,
  rewardSkip:       0.0,
  rewardSkipMissed: -3.0,
  rewardGoodSkip:   1.5,

  // ── SIZING ──────────────────────────────────────────────────
  sizeMultiplierHigh: 2.0,
  sizeMultiplierMax:  3.0,
  sizeMultiplierLow:  0.5,
};

// ── FEATURE EXTRACTION → ESTADO ELITE (20 features) ────────────
export function marketToState(candles) {
  if (!candles || candles.length < 200) return 0;

  const price = candles[candles.length - 1].close;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const vols = candles.map(c => c.vol);

  const features = [];

  // ═══ INDICADORES CLÁSICOS (F1-F8) ══════════════════════════
  const ema50 = ema(closes, 50);
  features.push(ema50[closes.length - 1] && price > ema50[closes.length - 1] ? 1 : 0);

  const ema200 = ema(closes, 200);
  features.push(ema200[closes.length - 1] && price > ema200[closes.length - 1] ? 1 : 0);

  const rsi = calcRSI(candles, 14);
  features.push(rsi && rsi.value > 50 ? 1 : 0);
  features.push(rsi && (rsi.value > 70 || rsi.value < 30) ? 1 : 0);

  const macd = calcMACD(candles);
  features.push(macd && macd.dir === 'up' ? 1 : 0);

  const adx = calcADX(candles);
  features.push(adx && adx.trending ? 1 : 0);

  const recentVol = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avgVol = vols.slice(-50).reduce((a, b) => a + b, 0) / 50;
  features.push(recentVol > avgVol * 1.5 ? 1 : 0);

  const regime = detectRegime(candles);
  features.push(regime && regime.regime === 'trending' ? 1 : 0);

  // ═══ ESTRUCTURA DE MERCADO (F9-F12) ═════════════════════════
  const structure = analyzeStructure(candles);
  features.push(structure && structure.bos ? 1 : 0);

  let obNear = false;
  if (structure && structure.blocks) {
    for (const block of structure.blocks) {
      if (Math.abs(price - block.price) / price < 0.02) { obNear = true; break; }
    }
  }
  features.push(obNear ? 1 : 0);

  let fvgExists = false;
  if (structure && structure.fvg) {
    for (const gap of structure.fvg) {
      if (price >= gap.low && price <= gap.high) { fvgExists = true; break; }
    }
  }
  features.push(fvgExists ? 1 : 0);

  let liqSweep = false;
  if (structure && structure.liquidity) {
    const recentHigh = Math.max(...highs.slice(-20));
    const recentLow = Math.min(...lows.slice(-20));
    if (price >= recentHigh * 0.998 || price <= recentLow * 1.002) liqSweep = true;
  }
  features.push(liqSweep ? 1 : 0);

  // ═══ MOMENTUM Y VOLATILIDAD (F13-F15) ═══════════════════════
  const mom5 = closes.length >= 6
    ? (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]
    : 0;
  const mom5Prev = closes.length >= 11
    ? (closes[closes.length - 6] - closes[closes.length - 11]) / closes[closes.length - 11]
    : 0;
  features.push(mom5 > mom5Prev && mom5 > 0 ? 1 : 0);

  const atr = calcATR(candles, 14);
  const atrPct = atr && price ? atr / price : 0;
  features.push(atrPct > 0.025 ? 1 : 0);

  const recent50High = Math.max(...highs.slice(-50));
  const recent50Low = Math.min(...lows.slice(-50));
  const range = recent50High - recent50Low;
  const position = (price - recent50Low) / (range || 1);
  features.push(position < 0.2 || position > 0.8 ? 1 : 0);

  // ═══ NEWS FEATURES (F16-F20) ════════════════════════════════
  const news = detectNews(candles);

  // F16: News detected (score >= 25)
  features.push(news.score >= 25 ? 1 : 0);

  // F17: News EXTREME (score >= 75)
  features.push(news.score >= 75 ? 1 : 0);

  // F18: News direction matches price direction
  features.push(news.score >= 25 && news.direction === 'BULLISH' && mom5 > 0 ? 1 :
                news.score >= 25 && news.direction === 'BEARISH' && mom5 < 0 ? 1 : 0);

  // F19: Fade detected (reversión después de noticia)
  features.push(news.isFade ? 1 : 0);

  // F20: Volume explosion (>5x promedio)
  features.push(news.volRatio >= 5 ? 1 : 0);

  // Convertir vector binario a número de estado
  let state = 0;
  for (let i = 0; i < features.length; i++) {
    state += (features[i] > 0.5 ? 1 : 0) * Math.pow(2, i);
  }
  return Math.min(state, NUM_STATES - 1);
}

// ── CONVICTION SIZING ──────────────────────────────────────────
export function convictionSize(confidence) {
  if (confidence >= 0.90) return { multiplier: PARAMS.sizeMultiplierMax, label: 'MAX_CONVICTION' };
  if (confidence >= 0.80) return { multiplier: PARAMS.sizeMultiplierHigh, label: 'HIGH_CONVICTION' };
  if (confidence >= 0.60) return { multiplier: 1.0, label: 'NORMAL' };
  if (confidence >= 0.50) return { multiplier: PARAMS.sizeMultiplierLow, label: 'LOW_CONVICTION' };
  return { multiplier: 0, label: 'SKIP' };
}

// ── Q-LEARNING: ELEGIR ACCION ───────────────────────────────────
export function chooseAction(state, epsilon) {
  if (Math.random() < epsilon) {
    return Math.random() < 0.4 ? 0 : 1;
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

// ── CALCULAR RECOMPENSA — MODO ELITE HUNTER ────────────────────
export function calcReward(won, pnl, action, newsContext = null) {
  if (action === 0) return PARAMS.rewardSkip;

  const absPnl = Math.abs(pnl);

  // ── REWARDS PARA NOTICIAS ──────────────────────────────────
  if (newsContext && newsContext.score >= 25) {
    if (won) {
      // Catch temprano en noticia = recompensa ÉPICA
      if (newsContext.score >= 75 && absPnl >= 0.03) return NEWS_REWARDS.catchEarly;
      if (newsContext.score >= 50) return NEWS_REWARDS.catchConfirmed;
      // Fade reversal = recompensa alta
      if (newsContext.isFade) return NEWS_REWARDS.fadeReversal;
      return PARAMS.rewardWin * (1 + absPnl * 5);
    } else {
      // Perder en noticia = penalización severa
      return NEWS_REWARDS.lossInNews * (1 + absPnl * 3);
    }
  }

  // ── REWARDS NORMALES (sin noticia) ─────────────────────────
  if (won) {
    if (absPnl >= 0.05) return PARAMS.rewardWinHuge;
    if (absPnl >= 0.03) return PARAMS.rewardWinBig;
    return PARAMS.rewardWin * (1 + absPnl * 5);
  } else {
    if (absPnl >= 0.03) return PARAMS.rewardLossBig;
    return PARAMS.rewardLoss * (1 + absPnl * 3);
  }
}

// ── REWARD POR SKIP ────────────────────────────────────────────
export function calcSkipReward(tradeWon, pnl, newsScore = 0) {
  // Skip en noticia moderada = penalizado (pierde oportunidad)
  if (newsScore >= 25 && newsScore < 75 && tradeWon) {
    return NEWS_REWARDS.skipModerate;
  }
  // Skip en noticia extrema = correcto (muy riesgoso)
  if (newsScore >= 75 && !tradeWon) {
    return NEWS_REWARDS.skipExtreme;
  }
  // Normal
  if (!tradeWon) return PARAMS.rewardGoodSkip;
  return PARAMS.rewardSkipMissed;
}

// ── ENTRENAR CON HISTORIAL — MODO ELITE ────────────────────────
export function trainFromHistory(trades, candlesBySymTf) {
  if (!trades || trades.length === 0) return;

  let epsilon = PARAMS.epsilonStart;
  let correctSkips = 0, correctTrades = 0, missedTrades = 0, totalDecisions = 0;
  let bigWins = 0, bigLosses = 0, newsTrades = 0, newsWins = 0;
  let fadeTrades = 0, fadeWins = 0;
  let winStreak = 0, loseStreak = 0, maxWinStreak = 0, maxLoseStreak = 0;

  // Reset learning stats
  learningStats = {
    totalDecisions: 0, tradesDecided: 0, skipsDecided: 0,
    correctTrades: 0, correctSkips: 0, missedTrades: 0,
    bigWins: 0, bigLosses: 0, newsTrades: 0, newsWins: 0,
    fadeTrades: 0, fadeWins: 0,
    maxWinStreak: 0, maxLoseStreak: 0,
    currentWinStreak: 0, currentLoseStreak: 0,
    confidenceHistory: [], rewardHistory: [],
    lastDecision: null, lastNewsScore: 0, trainingHistory: [],
  };

  for (let ep = 0; ep < 150; ep++) {
    let epReward = 0;
    let epTrades = 0, epSkips = 0, epWins = 0;

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

      const newsAtEntry = detectNews(candles.slice(0, entryIdx + 1));
      const isNews = newsAtEntry.score >= 25;
      const isFade = newsAtEntry.isFade;

      let reward;
      if (action === 0) {
        // SKIP
        reward = calcSkipReward(won, pnl, newsAtEntry.score);
        learningStats.skipsDecided++;
        epSkips++;
        if (!won) {
          correctSkips++;
          learningStats.correctSkips++;
        } else {
          missedTrades++;
          learningStats.missedTrades++;
        }
      } else {
        // TRADE
        reward = calcReward(won, pnl, 1, newsAtEntry);
        learningStats.tradesDecided++;
        epTrades++;
        if (won) {
          correctTrades++;
          learningStats.correctTrades++;
          winStreak++;
          loseStreak = 0;
          maxWinStreak = Math.max(maxWinStreak, winStreak);
          epWins++;
          if (Math.abs(pnl) >= 0.03) {
            bigWins++;
            learningStats.bigWins++;
          }
          if (isNews) {
            newsTrades++;
            newsWins++;
            learningStats.newsTrades++;
            learningStats.newsWins++;
          }
          if (isFade) {
            fadeTrades++;
            fadeWins++;
            learningStats.fadeTrades++;
            learningStats.fadeWins++;
          }
        } else {
          loseStreak++;
          winStreak = 0;
          maxLoseStreak = Math.max(maxLoseStreak, loseStreak);
          if (Math.abs(pnl) >= 0.03) {
            bigLosses++;
            learningStats.bigLosses++;
          }
          if (isNews) {
            newsTrades++;
            learningStats.newsTrades++;
          }
        }
      }

      totalDecisions++;
      epReward += reward;

      const nextState = marketToState(candles.slice(0, Math.min(entryIdx + 50, candles.length)));
      updateQ(state, action, reward, nextState);
    }

    // Track epoch stats
    learningStats.totalDecisions = totalDecisions;
    learningStats.maxWinStreak = maxWinStreak;
    learningStats.maxLoseStreak = maxLoseStreak;
    learningStats.currentWinStreak = winStreak;
    learningStats.currentLoseStreak = loseStreak;

    if (ep % 10 === 0) {
      learningStats.trainingHistory.push({
        episode: ep,
        reward: +epReward.toFixed(2),
        winRate: epTrades > 0 ? +((epWins / epTrades) * 100).toFixed(1) : 0,
        trades: epTrades,
        skips: epSkips,
      });
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
    newsTrades,
    newsWins,
    fadeTrades,
    fadeWins,
    maxWinStreak,
    maxLoseStreak,
    epsilon: +epsilon.toFixed(3),
    statesExplored: getExploredStates(),
    statesTotal: NUM_STATES,
  };
}

// ── ENTRENAR EN TRADES GANADORES REALES (+3%+) ─────────────────
export function trainOnWinners(winningTrades, candlesBySymTf) {
  if (!winningTrades || winningTrades.length === 0) return null;

  let trained = 0;
  for (let ep = 0; ep < 50; ep++) {
    for (const trade of winningTrades) {
      const key = `${trade.sym}-${trade.tf}`;
      const candles = candlesBySymTf[key];
      if (!candles || candles.length < 200) continue;

      const entryIdx = candles.findIndex(c => c.time >= trade.entryTime);
      if (entryIdx < 200) continue;

      const state = marketToState(candles.slice(0, entryIdx + 1));
      const action = 1;
      const won = trade.result === 'WIN';
      const pnl = trade.pnl || 0;

      const newsAtEntry = detectNews(candles.slice(0, entryIdx + 1));
      const reward = calcReward(won, pnl, 1, newsAtEntry);
      const nextState = marketToState(candles.slice(0, Math.min(entryIdx + 50, candles.length)));

      updateQ(state, action, reward, nextState);
      trained++;
    }
  }

  return { trainedOn: trained, winners: winningTrades.length };
}

// ── ENTRENAR EN NOTICIAS HISTÓRICAS ────────────────────────────
// "El tiburón de élite aprende a cazar en tormentas"
export function trainOnNews(newsTrades, candlesBySymTf) {
  if (!newsTrades || newsTrades.length === 0) return null;

  let trained = 0;
  // 75 episodes enfocados solo en noticias
  for (let ep = 0; ep < 75; ep++) {
    for (const trade of newsTrades) {
      const key = `${trade.sym}-${trade.tf}`;
      const candles = candlesBySymTf[key];
      if (!candles || candles.length < 200) continue;

      const entryIdx = candles.findIndex(c => c.time >= trade.entryTime);
      if (entryIdx < 200) continue;

      const state = marketToState(candles.slice(0, entryIdx + 1));
      const action = 1; // Forzar TRADE en entrenamiento de noticias
      const won = trade.result === 'WIN';
      const pnl = trade.pnl || 0;

      const newsAtEntry = detectNews(candles.slice(0, entryIdx + 1));
      const reward = calcReward(won, pnl, 1, newsAtEntry);
      const nextState = marketToState(candles.slice(0, Math.min(entryIdx + 50, candles.length)));

      updateQ(state, action, reward, nextState);
      trained++;
    }
  }

  return { trainedOn: trained, newsTrades: newsTrades.length };
}

// ── PREDICCIÓN DEL AGENTE — CON NEWS CONTEXT ───────────────────
export function agentPredict(candles, newsScore = 0) {
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

  // Confidence
  const diff = qTrade - qSkip;
  const maxQ = Math.max(Math.abs(qTrade), Math.abs(qSkip), 0.01);
  const confidence = 1 / (1 + Math.exp(-diff / maxQ * 3));

  // Sizing:.news-aware
  let sizing;
  if (action === 1) {
    if (newsScore >= 50 && confidence >= 0.80) {
      sizing = { multiplier: PARAMS.sizeMultiplierMax, label: 'NEWS_MAX' };
    } else if (newsScore >= 25 && confidence >= 0.70) {
      sizing = { multiplier: PARAMS.sizeMultiplierHigh, label: 'NEWS_AGGRESSIVE' };
    } else {
      sizing = convictionSize(confidence);
    }
  } else {
    sizing = { multiplier: 0, label: 'SKIP' };
  }

  // Risk level
  let riskLevel;
  if (newsScore >= 75) riskLevel = 'EXTREME_NEWS';
  else if (newsScore >= 50) riskLevel = 'HIGH_NEWS';
  else if (newsScore >= 25) riskLevel = 'MODERATE_NEWS';
  else if (confidence >= 0.85) riskLevel = 'AGGRESSIVE';
  else if (confidence >= 0.65) riskLevel = 'NORMAL';
  else if (confidence >= 0.50) riskLevel = 'CONSERVATIVE';
  else riskLevel = 'AVOID';

  return {
    action: action === 1 ? 'TRADE' : 'SKIP',
    confidence: +confidence.toFixed(3),
    state,
    qTrade: +qTrade.toFixed(4),
    qSkip: +qSkip.toFixed(4),
    sizing,
    riskLevel,
    newsScore,
    reason: action === 1
      ? `ELITE HUNTER (${riskLevel})`
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

  // Calcular win rate
  const totalTrades = learningStats.correctTrades + (learningStats.tradesDecided - learningStats.correctTrades);
  const winRate = totalTrades > 0 ? (learningStats.correctTrades / totalTrades * 100) : 0;

  // Calcular accuracy de noticias
  const newsAccuracy = learningStats.newsTrades > 0
    ? (learningStats.newsWins / learningStats.newsTrades * 100) : 0;

  return {
    episodes: episodeCount,
    totalReward: +totalReward.toFixed(2),
    avgRecentReward: +avgRecent.toFixed(2),
    statesExplored: explored,
    statesTotal: NUM_STATES,
    explorationPct: +(explored / NUM_STATES * 100).toFixed(4),
    epsilon: +(Math.max(PARAMS.epsilonMin, PARAMS.epsilonStart * Math.pow(PARAMS.epsilonDecay, episodeCount))).toFixed(3),
    mode: 'ELITE HUNTER v8.0',
    features: 20,
    maxStates: NUM_STATES,
    // Learning stats
    learning: {
      totalDecisions: learningStats.totalDecisions,
      tradesDecided: learningStats.tradesDecided,
      skipsDecided: learningStats.skipsDecided,
      correctTrades: learningStats.correctTrades,
      correctSkips: learningStats.correctSkips,
      missedTrades: learningStats.missedTrades,
      bigWins: learningStats.bigWins,
      bigLosses: learningStats.bigLosses,
      winRate: +winRate.toFixed(1),
      // News stats
      newsTrades: learningStats.newsTrades,
      newsWins: learningStats.newsWins,
      newsAccuracy: +newsAccuracy.toFixed(1),
      fadeTrades: learningStats.fadeTrades,
      fadeWins: learningStats.fadeWins,
      // Streaks
      maxWinStreak: learningStats.maxWinStreak,
      maxLoseStreak: learningStats.maxLoseStreak,
      currentWinStreak: learningStats.currentWinStreak,
      currentLoseStreak: learningStats.currentLoseStreak,
      // History
      trainingHistory: learningStats.trainingHistory,
      rewardHistory: winHistory.slice(-20),
    },
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
    version: 'ELITE-HUNTER-8.0',
    features: 20,
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
