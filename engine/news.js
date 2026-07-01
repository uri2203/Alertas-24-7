// ═══════════════════════════════════════════════════════════════
//  engine/news.js  —  Trading Dashboard PRO v8.0 ELITE
//  News Detection Engine: detecta movimientos de noticia en
//  tiempo real basándose en volumen, precio, volatilidad y spread
//  "Las noticias mueven mercados, el tiburón los caza"
// ═══════════════════════════════════════════════════════════════

// ── UMBRALES DE DETECCIÓN ───────────────────────────────────────
const THRESHOLDS = {
  // Volumen: spike >5x promedio = noticia
  volumeSpikeMultiplier: 5,
  volumeLookback: 20,        // velas para calcular promedio

  // Precio: salto >2% en 1 vela = jump
  priceJumpPct: 2.0,

  // Spread: ampliación >3x normal = liquidez baja
  spreadMultiplier: 3,
  spreadNormalPct: 0.05,     // spread normal 0.05%

  // ATR: explosión >100% = volatilidad extrema
  atrExplosionMultiplier: 2, // ATR actual vs ATR promedio

  // Momentum: >3% en 3 velas = movimiento fuerte
  momentumThreshold: 3.0,
  momentumWindow: 3,

  // Liquidity: volumen bajo = vacío
  lowLiquidityVolMultiplier: 0.3, // <30% del promedio
};

// ── NEWS SCORE: 0-100 ───────────────────────────────────────────
// Combina múltiples indicadores para detectar si hay noticia
export function detectNews(candles, previousCandles = null) {
  if (!candles || candles.length < THRESHOLDS.volumeLookback + 10) {
    return { score: 0, signals: [], level: 'none', details: {} };
  }

  const signals = [];
  let totalScore = 0;

  const current = candles[candles.length - 1];
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const vols = candles.map(c => c.vol);

  // ═══ SIGNAL 1: VOLUME SPIKE (0-25 pts) ══════════════════════
  const volRecent = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volAvg = vols.slice(-THRESHOLDS.volumeLookback - 5, -5).reduce((a, b) => a + b, 0) / THRESHOLDS.volumeLookback;
  const volRatio = volAvg > 0 ? volRecent / volAvg : 1;

  if (volRatio >= THRESHOLDS.volumeSpikeMultiplier) {
    const pts = Math.min(25, Math.floor((volRatio - THRESHOLDS.volumeSpikeMultiplier) * 5 + 15));
    totalScore += pts;
    signals.push({ type: 'volume_spike', ratio: +volRatio.toFixed(1), pts });
  }

  // ═══ SIGNAL 2: PRICE JUMP (0-25 pts) ════════════════════════
  const priceChange = Math.abs((current.close - candles[candles.length - 2].close) / candles[candles.length - 2].close * 100);

  if (priceChange >= THRESHOLDS.priceJumpPct) {
    const pts = Math.min(25, Math.floor((priceChange - THRESHOLDS.priceJumpPct) * 5 + 15));
    totalScore += pts;
    signals.push({ type: 'price_jump', changePct: +priceChange.toFixed(2), pts });
  }

  // ═══ SIGNAL 3: ATR EXPLOSION (0-20 pts) ══════════════════════
  const atrRecent = calculateATR(candles, 14);
  const atrPrev = calculateATR(candles.slice(0, -5), 14);
  const atrRatio = atrPrev > 0 ? atrRecent / atrPrev : 1;

  if (atrRatio >= THRESHOLDS.atrExplosionMultiplier) {
    const pts = Math.min(20, Math.floor((atrRatio - THRESHOLDS.atrExplosionMultiplier) * 10 + 10));
    totalScore += pts;
    signals.push({ type: 'atr_explosion', ratio: +atrRatio.toFixed(1), pts });
  }

  // ═══ SIGNAL 4: MOMENTUM ACCELERATION (0-15 pts) ══════════════
  const momWindow = THRESHOLDS.momentumWindow;
  if (closes.length >= momWindow + 1) {
    const momentum = Math.abs((closes[closes.length - 1] - closes[closes.length - 1 - momWindow]) / closes[closes.length - 1 - momWindow] * 100);

    if (momentum >= THRESHOLDS.momentumThreshold) {
      const pts = Math.min(15, Math.floor((momentum - THRESHOLDS.momentumThreshold) * 3 + 8));
      totalScore += pts;
      signals.push({ type: 'momentum_acceleration', momentumPct: +momentum.toFixed(2), pts });
    }
  }

  // ═══ SIGNAL 5: LOW LIQUIDITY (0-15 pts) ══════════════════════
  const recentVolLow = vols.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const volAvgFull = vols.reduce((a, b) => a + b, 0) / vols.length;

  if (volAvgFull > 0 && recentVolLow / volAvgFull < THRESHOLDS.lowLiquidityVolMultiplier) {
    const pts = 15;
    totalScore += pts;
    signals.push({ type: 'low_liquidity', ratio: +(recentVolLow / volAvgFull).toFixed(2), pts });
  }

  // ═══ SIGNAL 6: MULTI-CANDLE PRESSURE (0-10 pts) ══════════════
  // 3+ velas consecutivas en la misma dirección = presión
  const last5 = candles.slice(-5);
  let consecutiveBull = 0, consecutiveBear = 0;
  for (let i = 1; i < last5.length; i++) {
    if (last5[i].close > last5[i].open) consecutiveBull++;
    else consecutiveBear++;
  }
  if (consecutiveBull >= 3 || consecutiveBear >= 3) {
    const pts = 10;
    totalScore += pts;
    signals.push({
      type: 'multi_candle_pressure',
      direction: consecutiveBull >= 3 ? 'bullish' : 'bearish',
      count: Math.max(consecutiveBull, consecutiveBear),
      pts,
    });
  }

  // ═══ NIVEL DE NOTICIA ════════════════════════════════════════
  totalScore = Math.min(100, totalScore);

  let level;
  if (totalScore >= 75) level = 'EXTREME';
  else if (totalScore >= 50) level = 'HIGH';
  else if (totalScore >= 25) level = 'MODERATE';
  else if (totalScore >= 10) level = 'LOW';
  else level = 'none';

  // Dirección del movimiento
  const direction = current.close > (candles[candles.length - 2]?.close || current.close) ? 'BULLISH' : 'BEARISH';

  // ¿Es Fade? (reversión después del movimiento inicial)
  const isFade = detectFade(candles);

  return {
    score: totalScore,
    level,
    signals,
    direction,
    isFade,
    volRatio: +volRatio.toFixed(1),
    priceChangePct: +priceChange.toFixed(2),
    atrRatio: +atrRatio.toFixed(1),
    details: {
      volumeSpike: signals.find(s => s.type === 'volume_spike'),
      priceJump: signals.find(s => s.type === 'price_jump'),
      atrExplosion: signals.find(s => s.type === 'atr_explosion'),
      momentum: signals.find(s => s.type === 'momentum_acceleration'),
      lowLiquidity: signals.find(s => s.type === 'low_liquidity'),
      multiCandle: signals.find(s => s.type === 'multi_candle_pressure'),
    },
  };
}

// ── DETECTAR FADE (reversión después de noticia) ───────────────
function detectFade(candles) {
  if (candles.length < 20) return false;

  // Si hubo un movimiento fuerte y ahora está revertiendo
  const last = candles[candles.length - 1];
  const prev5 = candles.slice(-6, -1);

  // Check 1: Las últimas 3 velas van contra la tendencia anterior
  const prevDirection = prev5[prev5.length - 1].close > prev5[0].close ? 'up' : 'down';
  const lastDirection = last.close > prev5[prev5.length - 1].close ? 'up' : 'down';

  if (prevDirection === lastDirection) return false;

  // Check 2: El último candle tiene cuerpo grande en contra
  const lastBody = Math.abs(last.close - last.open);
  const avgBody = prev5.reduce((a, c) => a + Math.abs(c.close - c.open), 0) / prev5.length;

  return lastBody > avgBody * 1.5;
}

// ── ATR HELPER ─────────────────────────────────────────────────
function calculateATR(candles, period) {
  if (candles.length < period + 1) return 0;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    sum += tr;
  }
  return sum / period;
}

// ── NEWS-TRAINED REWARDS ───────────────────────────────────────
// Recompensas especiales para operar en noticias
export const NEWS_REWARDS = {
  // Catch temprano (primeras 3 velas de la noticia)
  catchEarly:     10,
  // Catch confirmado (velas 4-10)
  catchConfirmed: 5,
  // Fade reversal (operar la reversión)
  fadeReversal:   7,
  // Entrar tarde (después de 10 velas)
  enterLate:      -3,
  // Perder en noticia (peligroso)
  lossInNews:     -5,
  // Skip noticia (correcto si es muy riesgoso)
  skipExtreme:    2,
  // Skip noticia moderada (pierde oportunidad)
  skipModerate:   -2,
};

// ── NEWS POSITION SIZING ───────────────────────────────────────
export function newsPositionSize(newsScore, confidence, spreadPct) {
  let multiplier = 1.0;
  let label = 'NORMAL';

  // Noticia extrema + alta confianza = maximal
  if (newsScore >= 75 && confidence >= 0.90) {
    multiplier = 3.0;
    label = 'NEWS_MAX';
  }
  // Noticia alta + buena confianza = agresivo
  else if (newsScore >= 50 && confidence >= 0.80) {
    multiplier = 2.0;
    label = 'NEWS_AGGRESSIVE';
  }
  // Noticia moderada = normal
  else if (newsScore >= 25) {
    multiplier = 1.0;
    label = 'NEWS_NORMAL';
  }
  // Sin noticia = conviction normal
  else {
    multiplier = confidence >= 0.90 ? 2.0 : confidence >= 0.80 ? 1.5 : 1.0;
    label = confidence >= 0.80 ? 'HIGH_CONVICTION' : 'NORMAL';
  }

  // Spread alto = reducir
  if (spreadPct > 0.3) {
    multiplier *= 0.5;
    label += '_SPREAD_PENALTY';
  } else if (spreadPct > 0.15) {
    multiplier *= 0.75;
    label += '_SPREAD_REDUCE';
  }

  return { multiplier: +multiplier.toFixed(2), label };
}

// ── NEWS SL/TP AJUSTADO ────────────────────────────────────────
// En noticias, SL más ajustado y TP más agresivo
export function newsSLTPAdjustment(newsScore, atrPct, direction) {
  if (newsScore < 25) return null; // Solo ajustar en noticias significativas

  // SL más ajustado en noticias (1.5x ATR en vez de 2x)
  const slMultiplier = newsScore >= 50 ? 1.2 : 1.5;
  // TP más agresivo (2.5x ATR en vez de 2x)
  const tpMultiplier = newsScore >= 50 ? 3.0 : 2.5;

  return {
    slMultiplier,
    tpMultiplier,
    reason: newsScore >= 50 ? 'EXTREME_NEWS' : 'MODERATE_NEWS',
    label: `ATR ${slMultiplier}x SL / ${tpMultiplier}x TP`,
  };
}
