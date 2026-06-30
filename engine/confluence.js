// ═══════════════════════════════════════════════════════════════
//  confluence.js  —  Multi-TF Confluence Engine v8.0
//  Análisis de estructura real del mercado
//  Enfoque: Velas menores construyen las mayores
// ═══════════════════════════════════════════════════════════════

import { analyzeStructure } from './structure.js';
import { calcRSI, ema } from './signals.js';

// ── ESTRUCTURA MULTI-TF ─────────────────────────────────────
// El mercado se estructura así:
//   1d = 24 velas de 1h
//   4h = 4 velas de 1h
//   1h = entrada precisa
//
// Si el 1d dice ALTO, el 4h debe mostrar pullback alcista,
// y el 1h debe confirmar la entrada.
export function analyzeMultiTF(candlesByTF) {
  // candlesByTF = { '1h': [...], '4h': [...], '1d': [...] }
  if (!candlesByTF || Object.keys(candlesByTF).length < 2) return null;

  const analysis = {};

  // Analizar cada TF por separado
  for (const [tf, candles] of Object.entries(candlesByTF)) {
    if (!candles || candles.length < 50) continue;
    analysis[tf] = analyzeStructure(candles);
  }

  // Determinar dirección macro (TF más alto disponible)
  const tfOrder = ['1d', '4h', '1h', '15m', '5m'];
  const availableTFs = tfOrder.filter(tf => analysis[tf]);

  if (availableTFs.length < 2) return null;

  const macroTF = availableTFs[0]; // TF más alto
  const midTF = availableTFs[1];   // TF medio
  const entryTF = availableTFs[availableTFs.length - 1]; // TF más bajo (entrada)

  const macro = analysis[macroTF];
  const mid = analysis[midTF];
  const entry = analysis[entryTF];

  // ── DIRECCIÓN MACRO ──────────────────────────────────────
  let macroDirection = 'neutral';
  if (macro?.structure?.trend === 'uptrend') macroDirection = 'bullish';
  else if (macro?.structure?.trend === 'downtrend') macroDirection = 'bearish';
  else if (macro?.structure?.lastBOS === 'bull') macroDirection = 'bullish';
  else if (macro?.structure?.lastBOS === 'bear') macroDirection = 'bearish';

  // ── PULLBACK EN TF MEDIO ─────────────────────────────────
  // En tendencia alcista, buscamos pullback a soporte en TF medio
  let pullbackSetup = null;
  if (macroDirection === 'bullish' && mid?.pullback?.type === 'bull_pullback') {
    pullbackSetup = {
      direction: 'long',
      zone: mid.pullback.zone,
      zonePrice: mid.pullback.zonePrice,
      reaction: mid.pullback.reaction,
      strength: mid.pullback.strength,
    };
  } else if (macroDirection === 'bearish' && mid?.pullback?.type === 'bear_pullback') {
    pullbackSetup = {
      direction: 'short',
      zone: mid.pullback.zone,
      zonePrice: mid.pullback.zonePrice,
      reaction: mid.pullback.reaction,
      strength: mid.pullback.strength,
    };
  }

  // ── CONFIRMACIÓN EN TF DE ENTRADA ────────────────────────
  let entryConfirmation = null;
  if (entry?.structure) {
    const entryTrend = entry.structure.trend;
    const matchesMacro =
      (macroDirection === 'bullish' && (entryTrend === 'uptrend' || entry.structure.lastBOS === 'bull')) ||
      (macroDirection === 'bearish' && (entryTrend === 'downtrend' || entry.structure.lastBOS === 'bear'));

    if (matchesMacro) {
      entryConfirmation = {
        trend: entryTrend,
        bos: entry.structure.lastBOS,
        inOB: !!entry.inOB,
        inFVG: !!entry.inFVG,
      };
    }
  }

  // ── SCORE DE CONFLUENCIA (0-100) ────────────────────────
  let score = 0;
  const maxScore = 100;

  // 1. Tendencia macro definida (25 pts)
  if (macroDirection !== 'neutral') score += 25;

  // 2. Pullback a zona de interés en TF medio (25 pts)
  if (pullbackSetup) {
    score += 15;
    if (pullbackSetup.reaction) score += 5; // Vela de reacción
    if (pullbackSetup.strength >= 3) score += 5; // Order block fuerte
  }

  // 3. Confirmación en TF de entrada (25 pts)
  if (entryConfirmation) {
    score += 15;
    if (entryConfirmation.inOB || entryConfirmation.inFVG) score += 10;
  }

  // 4. Alineación de tendencia entre TFs (15 pts)
  const macroTrend = macro?.structure?.trend;
  const midTrend = mid?.structure?.trend;
  const entryTrend = entry?.structure?.trend;

  if (macroTrend === midTrend && midTrend === entryTrend && macroTrend !== 'neutral') {
    score += 15; // Todos los TFs alineados
  } else if (macroTrend === midTrend || midTrend === entryTrend) {
    score += 8; // Al menos 2 TFs alineados
  }

  // 5. BOS reciente en dirección correcta (10 pts)
  if (entry?.structure?.lastBOS) {
    if (macroDirection === 'bullish' && entry.structure.lastBOS === 'bull') score += 10;
    if (macroDirection === 'bearish' && entry.structure.lastBOS === 'bear') score += 10;
  }

  return {
    macroDirection,
    pullbackSetup,
    entryConfirmation,
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    analysis,
    availableTFs,
  };
}

// ── INDICADORES COMPLEMENTARIOS ─────────────────────────────
// No como señales principales, sino como filtros de confirmación
export function complementaryIndicators(candles) {
  if (!candles || candles.length < 50) return null;

  const last = candles[candles.length - 1];
  const rsi = calcRSI(candles, 14);
  const ema20 = ema(candles.map(c => c.close), 20);
  const ema50 = ema(candles.map(c => c.close), 50);

  // Volumen: comparar con promedio de 20 velas
  const volumes = candles.slice(-20).map(c => c.volume || 0);
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const currentVol = last.volume || 0;
  const volRatio = avgVol > 0 ? currentVol / avgVol : 1;

  // Momentum: comparar close actual con close de 10 velas atrás
  const momentum = candles.length >= 10
    ? (last.close - candles[candles.length - 11].close) / candles[candles.length - 11].close
    : 0;

  // Volatilidad: ATR relativo
  const ranges = candles.slice(-14).map(c => c.high - c.low);
  const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const atrPct = last.close > 0 ? (atr / last.close) * 100 : 0;

  return {
    rsi,
    ema20,
    ema50,
    volRatio: Math.round(volRatio * 100) / 100,
    momentum: Math.round(momentum * 10000) / 100, // En puntos base
    atrPct: Math.round(atrPct * 100) / 100,
    priceAboveEMA20: last.close > ema20,
    priceAboveEMA50: last.close > ema50,
    ema20Above50: ema20 > ema50,
    volumeConfirm: volRatio > 1.2,
  };
}

// ── SCORING FINAL ESTRUCTURA (0-100) ────────────────────────
// Sistema de scoring basado en ESTRUCTURA, no en indicadores genéricos
export function structureScore(multiTF, indicators) {
  if (!multiTF) return { score: 0, maxScore: 100, quality: 'none', reasons: [] };

  let score = 0;
  const reasons = [];

  // ═══ ESTRUCTURA (60 pts) ══════════════════════════════════
  const s = multiTF.score;

  // 1. Confluencia multi-TF (30 pts)
  const confluencePts = Math.round((s / 100) * 30);
  score += confluencePts;
  if (confluencePts >= 20) reasons.push('confluencia_multi_tf');

  // 2. Pullback a zona de interés (15 pts)
  if (multiTF.pullbackSetup) {
    score += 10;
    reasons.push(`pullback_${multiTF.pullbackSetup.zone}`);
    if (multiTF.pullbackSetup.reaction) {
      score += 5;
      reasons.push('vela_reaccion');
    }
  }

  // 3. BOS en dirección correcta (10 pts)
  if (multiTF.entryConfirmation?.bos) {
    score += 10;
    reasons.push(`bos_${multiTF.entryConfirmation.bos}`);
  }

  // 4. Price en OB/FVG (5 pts)
  if (multiTF.entryConfirmation?.inOB) { score += 3; reasons.push('en_order_block'); }
  if (multiTF.entryConfirmation?.inFVG) { score += 2; reasons.push('en_fvg'); }

  // ═══ CONFIRMACIÓN (40 pts) ════════════════════════════════
  if (indicators) {
    // 5. RSI no sobrecompra/sobreventa (10 pts)
    if (indicators.rsi != null) {
      if (multiTF.macroDirection === 'bullish' && indicators.rsi < 70 && indicators.rsi > 30) {
        score += 10;
        reasons.push('rsi_neutral');
      } else if (multiTF.macroDirection === 'bearish' && indicators.rsi > 30 && indicators.rsi < 70) {
        score += 10;
        reasons.push('rsi_neutral');
      } else if (indicators.rsi < 30 || indicators.rsi > 70) {
        // Sobrecompra/sobreventa puede ser buena en pullback
        score += 5;
        reasons.push('rsi_extremo_pullback');
      }
    }

    // 6. Volumen confirma (10 pts)
    if (indicators.volumeConfirm) {
      score += 10;
      reasons.push('volumen_confirmado');
    } else if (indicators.volRatio > 1.0) {
      score += 5;
      reasons.push('volumen_normal');
    }

    // 7. EMA alineación (10 pts)
    if (multiTF.macroDirection === 'bullish' && indicators.priceAboveEMA20 && indicators.ema20Above50) {
      score += 10;
      reasons.push('ema_alineada_alcista');
    } else if (multiTF.macroDirection === 'bearish' && !indicators.priceAboveEMA20 && !indicators.ema20Above50) {
      score += 10;
      reasons.push('ema_alineada_bajista');
    } else if (indicators.priceAboveEMA20 || !indicators.priceAboveEMA20) {
      score += 3;
    }

    // 8. Momentum a favor (5 pts)
    if (multiTF.macroDirection === 'bullish' && indicators.momentum > 0) {
      score += 5;
      reasons.push('momentum_alcista');
    } else if (multiTF.macroDirection === 'bearish' && indicators.momentum < 0) {
      score += 5;
      reasons.push('momentum_bajista');
    }

    // 9. Volatilidad razonable (5 pts)
    if (indicators.atrPct > 0.3 && indicators.atrPct < 3.0) {
      score += 5;
      reasons.push('volatilidad_ok');
    }
  }

  // ═══ PENALIZACIONES ═══════════════════════════════════════
  // Sin tendencia clara
  if (multiTF.macroDirection === 'neutral') {
    score = Math.max(0, score - 30);
    reasons.push('penalizacion_sin_tendencia');
  }

  // Sin pullback
  if (!multiTF.pullbackSetup) {
    score = Math.max(0, score - 15);
    reasons.push('penalizacion_sin_pullback');
  }

  // TFs en contra
  if (multiTF.analysis) {
    const trends = Object.values(multiTF.analysis)
      .map(a => a?.structure?.trend)
      .filter(Boolean);
    const bullish = trends.filter(t => t === 'uptrend').length;
    const bearish = trends.filter(t => t === 'downtrend').length;
    if (bullish > 0 && bearish > 0) {
      score = Math.max(0, score - 10);
      reasons.push('penalizacion_tfs_contradictorios');
    }
  }

  // ═══ QUALITY RATING ═══════════════════════════════════════
  let quality = 'none';
  if (score >= 85) quality = 'elite';
  else if (score >= 70) quality = 'strong';
  else if (score >= 55) quality = 'moderate';
  else if (score >= 40) quality = 'weak';

  return {
    score: Math.min(100, score),
    maxScore: 100,
    quality,
    reasons,
    direction: multiTF.macroDirection === 'bullish' ? 'LONG' : multiTF.macroDirection === 'bearish' ? 'SHORT' : 'WAIT',
  };
}
