// ═══════════════════════════════════════════════════════════════
//  funding.js  —  Funding Rate & Open Interest Analysis v8.0
//  "El apalancamiento mata más rápido que la volatilidad"
//
//  API INTEGRATION: Pendiente — usar datos de Binance Futures
//  GET /fapi/v1/fundingRate
//  GET /fapi/v1/openInterest
//  GET /futures/data/globalLongShortAccountRatio
// ═══════════════════════════════════════════════════════════════

// ── ANÁLISIS DE FUNDING RATE ─────────────────────────────────
// Funding rate alto = mercado sobre-apalancado = trampa
export function analyzeFundingRate(fundingRate, direction) {
  if (fundingRate == null) return { score: 0, signal: 'neutral', reason: 'sin_datos' };

  const rate = fundingRate * 100; // Convertir a porcentaje

  let score = 0;
  let signal = 'neutral';
  let reason = '';

  // ═══ FUNDING ALTO POSITIVO (>0.05%) ═══════════════════════
  if (rate > 0.05) {
    signal = 'overleveraged_long';
    reason = `funding extremo ${rate.toFixed(4)}% — demasiados largos`;

    if (direction === 'LONG') {
      score = -15; // Penalización fuerte: trampa alcista
      reason += ' → TRAMPA LONG';
    } else {
      score = 5; // Leve favor para SHORT
      reason += ' → oportunidad short';
    }
  }
  // ═══ FUNDING MODERADO POSITIVO (0.02-0.05%) ═══════════════
  else if (rate > 0.02) {
    signal = 'mild_long_bias';
    reason = `funding elevado ${rate.toFixed(4)}%`;

    if (direction === 'LONG') {
      score = -8;
      reason += ' → precaución long';
    } else {
      score = 3;
    }
  }
  // ═══ FUNDING NORMAL (-0.02% a 0.02%) ═════════════════════
  else if (rate >= -0.02 && rate <= 0.02) {
    signal = 'neutral';
    reason = `funding neutral ${rate.toFixed(4)}%`;
    score = 0;
  }
  // ═══ FUNDING NEGATIVO MODERADO (-0.05% a -0.02%) ═════════
  else if (rate >= -0.05 && rate < -0.02) {
    signal = 'mild_short_bias';
    reason = `funding negativo ${rate.toFixed(4)}%`;

    if (direction === 'LONG') {
      score = 5; // Favorable para LONG
      reason += ' → oportunidad long';
    } else {
      score = -5;
    }
  }
  // ═══ FUNDING NEGATIVO EXTREMO (<-0.05%) ══════════════════
  else {
    signal = 'overleveraged_short';
    reason = `funding extremo negativo ${rate.toFixed(4)}% — demasiados cortos`;

    if (direction === 'LONG') {
      score = 10; // Gran oportunidad long (short squeeze)
      reason += ' → SHORT SQUEEZE probable';
    } else {
      score = -10;
      reason += ' → trampa short';
    }
  }

  return {
    score,
    signal,
    reason,
    rate: Math.round(rate * 10000) / 10000,
    isDangerous: Math.abs(rate) > 0.05,
  };
}

// ── ANÁLISIS DE OPEN INTEREST ────────────────────────────────
export function analyzeOpenInterest(oi, oiChange, priceChange) {
  if (oi == null || oiChange == null || priceChange == null) {
    return { score: 0, signal: 'neutral', reason: 'sin_datos' };
  }

  let score = 0;
  let signal = 'neutral';
  let reason = '';

  // ═══ OI SUBE + PRECIO SUBE = Tendencia fuerte ════════════
  if (oiChange > 5 && priceChange > 1) {
    signal = 'strong_uptrend';
    reason = `OI +${oiChange.toFixed(1)}% + precio +${priceChange.toFixed(1)}% — tendencia confirmada`;
    score = 8;
  }
  // ═══ OI SUBE + PRECIO BAJA = Posible rebote (short squeeze) ═
  else if (oiChange > 5 && priceChange < -1) {
    signal = 'potential_squeeze';
    reason = `OI +${oiChange.toFixed(1)}% + precio ${priceChange.toFixed(1)}% — posibles liquidaciones`;
    score = 5; // Leve favor long (squeeze)
  }
  // ═══ OI BAJA + PRECIO SUBE = Rally débil ═════════════════
  else if (oiChange < -5 && priceChange > 1) {
    signal = 'weak_rally';
    reason = `OI ${oiChange.toFixed(1)}% + precio +${priceChange.toFixed(1)}% — short cubriéndose`;
    score = -3; // Rally no sostenible
  }
  // ═══ OI BAJA + PRECIO BAJA = Capitulación ════════════════
  else if (oiChange < -5 && priceChange < -1) {
    signal = 'capitulation';
    reason = `OI ${oiChange.toFixed(1)}% + precio ${priceChange.toFixed(1)}% — capitulación`;
    score = 3; // Posible fondo
  }
  // ═══ CAMBIOS MENORES ══════════════════════════════════════
  else {
    signal = 'neutral';
    reason = `OI cambio ${oiChange.toFixed(1)}%, precio ${priceChange.toFixed(1)}%`;
  }

  return {
    score,
    signal,
    reason,
    oiChange: Math.round(oiChange * 100) / 100,
    priceChange: Math.round(priceChange * 100) / 100,
  };
}

// ── LONG/SHORT RATIO ═════════════════════════════════════════
export function analyzeLongShortRatio(ratio, direction) {
  if (ratio == null) return { score: 0, signal: 'neutral', reason: 'sin_datos' };

  // ratio > 1 = más largos que cortos
  // ratio < 1 = más cortos que largos

  let score = 0;
  let signal = 'neutral';
  let reason = '';

  if (ratio > 2.0) {
    signal = 'extreme_long';
    reason = `L/S ratio ${ratio.toFixed(2)} — mercado muy sesgado alcista`;
    score = direction === 'LONG' ? -10 : 5;
  } else if (ratio > 1.5) {
    signal = 'mild_long';
    reason = `L/S ratio ${ratio.toFixed(2)} — sesgo alcista`;
    score = direction === 'LONG' ? -5 : 3;
  } else if (ratio >= 0.67 && ratio <= 1.5) {
    signal = 'balanced';
    reason = `L/S ratio ${ratio.toFixed(2)} — equilibrado`;
    score = 0;
  } else if (ratio >= 0.5 && ratio < 0.67) {
    signal = 'mild_short';
    reason = `L/S ratio ${ratio.toFixed(2)} — sesgo bajista`;
    score = direction === 'LONG' ? 5 : -3;
  } else {
    signal = 'extreme_short';
    reason = `L/S ratio ${ratio.toFixed(2)} — mercado muy sesgado bajista`;
    score = direction === 'LONG' ? 10 : -5;
  }

  return {
    score,
    signal,
    reason,
    ratio: Math.round(ratio * 100) / 100,
    isExtreme: ratio > 2 || ratio < 0.5,
  };
}

// ── SCORE COMBINADO DE FUNDING ═══════════════════════════════
export function fundingScore(fundingRate, oi, oiChange, priceChange, lsr, direction) {
  const funding = analyzeFundingRate(fundingRate, direction);
  const oiAnalysis = analyzeOpenInterest(oi, oiChange, priceChange);
  const lsrAnalysis = analyzeLongShortRatio(lsr, direction);

  const totalScore = funding.score + oiAnalysis.score + lsrAnalysis.score;

  // Clasificar riesgo de liquidación
  let liquidationRisk = 'low';
  if (funding.isDangerous || lsrAnalysis.isExtreme) {
    liquidationRisk = 'high';
  } else if (Math.abs(funding.rate) > 0.03 || lsrAnalysis.ratio > 1.8 || lsrAnalysis.ratio < 0.55) {
    liquidationRisk = 'medium';
  }

  return {
    score: Math.max(-25, Math.min(25, totalScore)),
    funding,
    oi: oiAnalysis,
    lsr: lsrAnalysis,
    liquidationRisk,
    summary: `Funding: ${funding.signal} | OI: ${oiAnalysis.signal} | L/S: ${lsrAnalysis.signal} | Riesgo: ${liquidationRisk}`,
  };
}

// ── PLACEHOLDER: FETCH DE DATOS (integrar después) ══════════
// Cuando se conecte la API de Binance Futures:
//
// export async function fetchFundingRate(symbol) {
//   const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
//   const res = await fetch(url);
//   const data = await res.json();
//   return data[0]?.fundingRate || null;
// }
//
// export async function fetchOpenInterest(symbol) {
//   const url = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`;
//   const res = await fetch(url);
//   const data = await res.json();
//   return data?.openInterest || null;
// }
//
// export async function fetchLongShortRatio(symbol, period = '1h') {
//   const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`;
//   const res = await fetch(url);
//   const data = await res.json();
//   return data[0]?.longShortRatio || null;
// }
