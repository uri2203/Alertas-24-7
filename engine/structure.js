// ═══════════════════════════════════════════════════════════════
//  structure.js  —  Market Structure Analysis v8.0
//  BOS, Order Blocks, FVG, Swing Structure, Liquidity Zones
//  Enfoque: Estructura real del mercado, no indicadores genéricos
// ═══════════════════════════════════════════════════════════════

// ── BREAK OF STRUCTURE (BOS) ─────────────────────────────────
// Detecta cuando el precio rompe un swing high/low previo
// Esto confirma cambio de estructura (CHoCH) o continuación (BOS)
export function detectBOS(candles, lookback = 50) {
  if (!candles || candles.length < lookback) return null;

  const highs = [];
  const lows = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    // Swing high: high mayor que sus 2 vecinos a cada lado
    if (c.high > candles[i-1].high && c.high > candles[i-2].high &&
        c.high > candles[i+1].high && c.high > candles[i+2].high) {
      highs.push({ idx: i, price: c.high, time: c.time });
    }
    // Swing low: low menor que sus 2 vecinos a cada lado
    if (c.low < candles[i-1].low && c.low < candles[i-2].low &&
        c.low < candles[i+1].low && c.low < candles[i+2].low) {
      lows.push({ idx: i, price: c.low, time: c.time });
    }
  }

  if (highs.length < 2 || lows.length < 2) return null;

  const lastPrice = candles[candles.length - 1].close;
  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  // BOS alcista: precio rompe swing high anterior
  const bullBOS = lastPrice > prevHigh.price && prevHigh.idx > lastLow?.idx;
  // BOS bajista: precio rompe swing low anterior
  const bearBOS = lastPrice < prevLow.price && prevLow.idx > lastHigh?.idx;

  // CHoCH: cambio de estructura (rompe en dirección contraria)
  const chochBull = lastPrice > prevHigh.price && lastPrice > prevHigh.price;
  const chochBear = lastPrice < prevLow.price;

  // Estructura actual
  let structure = 'ranging';
  if (bullBOS) structure = 'bullish_bos';
  else if (bearBOS) structure = 'bearish_bos';
  else if (chochBull) structure = 'bullish_choch';
  else if (chochBear) structure = 'bearish_choch';

  // HH/HL (Higher Highs / Higher Lows) = uptrend
  const hh = lastHigh.price > prevHigh.price;
  const hl = lastLow.price > prevLow.price;
  const ll = lastLow.price < prevLow.price;
  const lh = lastHigh.price < prevHigh.price;

  let trend = 'neutral';
  if (hh && hl) trend = 'uptrend';
  else if (ll && lh) trend = 'downtrend';

  return {
    structure,
    trend,
    swingHighs: highs.slice(-3),
    swingLows: lows.slice(-3),
    lastBOS: bullBOS ? 'bull' : bearBOS ? 'bear' : null,
    hh, hl, ll, lh,
  };
}

// ── ORDER BLOCKS ─────────────────────────────────────────────
// Zonas donde grandes instituciones dejaron órdenes pendientes
// Última vela contra-tendencia antes de un movimiento fuerte
export function detectOrderBlocks(candles, lookback = 100) {
  if (!candles || candles.length < 20) return [];

  const blocks = [];
  const recent = candles.slice(-lookback);

  for (let i = 5; i < recent.length - 2; i++) {
    const curr = recent[i];
    const next = recent[i + 1];
    const next2 = recent[i + 2];

    if (!curr || !next || !next2) continue;

    const bodySize = Math.abs(curr.close - curr.open);
    const nextMove = Math.abs(next2.close - curr.close);

    // Bullish OB: vela bajista seguida de movimiento alcista fuerte
    if (curr.close < curr.open && next2.close > next.close && nextMove > bodySize * 2) {
      const midBody = (curr.open + curr.close) / 2;
      blocks.push({
        type: 'bull_ob',
        high: curr.high,
        low: midBody, // Mitad del body = zona más fuerte
        origin: curr.time,
        strength: Math.min(nextMove / bodySize, 5),
      });
    }

    // Bearish OB: vela alcista seguida de movimiento bajista fuerte
    if (curr.close > curr.open && next2.close < next.close && nextMove > bodySize * 2) {
      const midBody = (curr.open + curr.close) / 2;
      blocks.push({
        type: 'bear_ob',
        high: midBody,
        low: curr.low,
        origin: curr.time,
        strength: Math.min(nextMove / bodySize, 5),
      });
    }
  }

  return blocks.slice(-5); // Últimos 5 order blocks
}

// ── FAIR VALUE GAP (FVG) ────────────────────────────────────
// Gap de precio donde no hubo liquidez — el precio tiende a volver
export function detectFVG(candles, lookback = 100) {
  if (!candles || candles.length < 10) return [];

  const fvgs = [];
  const recent = candles.slice(-lookback);

  for (let i = 1; i < recent.length - 1; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    const next = recent[i + 1];

    if (!prev || !curr || !next) continue;

    // Bullish FVG: gap entre high de prev y low de next (precio subió rápido)
    if (prev.high < next.low) {
      fvgs.push({
        type: 'bull_fvg',
        high: next.low,
        low: prev.high,
        time: curr.time,
        filled: false,
      });
    }

    // Bearish FVG: gap entre low de prev y high de next (precio bajó rápido)
    if (prev.low > next.high) {
      fvgs.push({
        type: 'bear_fvg',
        high: prev.low,
        low: next.high,
        time: curr.time,
        filled: false,
      });
    }
  }

  // Marcar FVGs que ya fueron llenados
  const lastPrice = candles[candles.length - 1].close;
  for (const fvg of fvgs) {
    if (fvg.type === 'bull_fvg' && lastPrice <= fvg.high && lastPrice >= fvg.low) {
      fvg.filled = true;
    }
    if (fvg.type === 'bear_fvg' && lastPrice >= fvg.low && lastPrice <= fvg.high) {
      fvg.filled = true;
    }
  }

  return fvgs.filter(f => !f.filled).slice(-3);
}

// ── LIQUIDITY ZONES ─────────────────────────────────────────
// Donde se acumulan stop losses (target de institutions)
export function detectLiquidityZones(candles, lookback = 100) {
  if (!candles || candles.length < 30) return { buyside: [], sellside: [] };

  const recent = candles.slice(-lookback);
  const buyside = [];  // Stop losses de longs (encima de highs repetidos)
  const sellside = []; // Stop losses de shorts (debajo de lows repetidos)

  // Contar cuántas veces cada precio fue tocado como high/low
  const highTouches = {};
  const lowTouches = {};

  for (const c of recent) {
    const hKey = c.high.toFixed(2);
    const lKey = c.low.toFixed(2);
    highTouches[hKey] = (highTouches[hKey] || 0) + 1;
    lowTouches[lKey] = (lowTouches[lKey] || 0) + 1;
  }

  // Zonas donde high fue tocado 3+ veces = buy-side liquidity
  for (const [price, count] of Object.entries(highTouches)) {
    if (count >= 3) buyside.push({ price: parseFloat(price), touches: count });
  }

  // Zonas donde low fue tocado 3+ veces = sell-side liquidity
  for (const [price, count] of Object.entries(lowTouches)) {
    if (count >= 3) sellside.push({ price: parseFloat(price), touches: count });
  }

  buyside.sort((a, b) => b.touches - a.touches);
  sellside.sort((a, b) => b.touches - a.touches);

  return { buyside: buyside.slice(0, 3), sellside: sellside.slice(0, 3) };
}

// ── PRECIO EN ORDER BLOCK / FVG ─────────────────────────────
// ¿El precio actual está en una zona de interés?
export function priceInZone(candle, blocks, fvgs) {
  if (!candle) return { inOB: null, inFVG: null };

  const price = candle.close;

  // ¿Está en un Order Block?
  let inOB = null;
  for (const ob of blocks) {
    if (price >= ob.low && price <= ob.high) {
      inOB = ob;
      break;
    }
  }

  // ¿Está en un FVG?
  let inFVG = null;
  for (const fvg of fvgs) {
    if (price >= fvg.low && price <= fvg.high) {
      inFVG = fvg;
      break;
    }
  }

  return { inOB, inFVG };
}

// ── PULLBACK DETECTION ──────────────────────────────────────
// Detecta si el precio hizo pullback a zona de interés
// en tendencia confirmada = alta probabilidad de continuación
export function detectPullback(candles, structure, blocks, fvgs) {
  if (!candles || candles.length < 10 || !structure) return null;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  const price = last.close;
  const { inOB, inFVG } = priceInZone(last, blocks, fvgs);

  let pullback = null;

  // Pullback alcista: en uptrend + precio tocó zona de soporte + vela reacciona
  if (structure.trend === 'uptrend') {
    if (inOB && inOB.type === 'bull_ob') {
      pullback = {
        type: 'bull_pullback',
        zone: 'order_block',
        zonePrice: `${inOB.low.toFixed(2)}-${inOB.high.toFixed(2)}`,
        reaction: last.close > last.open, // Vela alcista de reacción
        strength: inOB.strength,
      };
    } else if (inFVG && inFVG.type === 'bull_fvg') {
      pullback = {
        type: 'bull_pullback',
        zone: 'fvg',
        zonePrice: `${inFVG.low.toFixed(2)}-${inFVG.high.toFixed(2)}`,
        reaction: last.close > last.open,
        strength: 2,
      };
    }
  }

  // Pullback bajista: en downtrend + precio tocó zona de resistencia + vela reacciona
  if (structure.trend === 'downtrend') {
    if (inOB && inOB.type === 'bear_ob') {
      pullback = {
        type: 'bear_pullback',
        zone: 'order_block',
        zonePrice: `${inOB.low.toFixed(2)}-${inOB.high.toFixed(2)}`,
        reaction: last.close < last.open,
        strength: inOB.strength,
      };
    } else if (inFVG && inFVG.type === 'bear_fvg') {
      pullback = {
        type: 'bear_pullback',
        zone: 'fvg',
        zonePrice: `${inFVG.low.toFixed(2)}-${inFVG.high.toFixed(2)}`,
        reaction: last.close < last.open,
        strength: 2,
      };
    }
  }

  return pullback;
}

// ── FILTRO DE SPREAD ──────────────────────────────────────────
// Spread máximo aceptable: 0.1% del precio
export function checkSpread(candles, maxSpreadPct = 0.1) {
  if (!candles || candles.length < 2) return { ok: true, spread: 0 };

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  // Spread estimado: diferencia entre close actual y close anterior
  // como proxy del spread real (necesitaríamos bid/ask para spread exacto)
  const priceChange = Math.abs(last.close - prev.close) / prev.close * 100;

  // También usar high-low como indicador de spread intra-vela
  const candleSpread = (last.high - last.low) / last.close * 100;

  // El spread efectivo es el menor de los dos
  const spread = Math.min(priceChange, candleSpread);

  return {
    ok: spread <= maxSpreadPct,
    spread: Math.round(spread * 1000) / 1000,
    maxSpreadPct,
  };
}

// ── FILTRO HORARIO ────────────────────────────────────────────
// Evitar horas de bajo volumen: 2-5am Mexico = movimientos falsos
export function checkTimeFilter() {
  const now = new Date();
  const mxHour = parseInt(now.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    hour: 'numeric',
    hour12: false,
  }));

  // Horas de bajo volumen (2-5am MX)
  const lowVolumeHours = [2, 3, 4, 5];
  const isLowVolume = lowVolumeHours.includes(mxHour);

  // Horas de alta liquidez (9am-4pm MX = NY session)
  const highLiquidityHours = [9, 10, 11, 12, 13, 14, 15, 16];
  const isHighLiquidity = highLiquidityHours.includes(mxHour);

  // Sesiones activas
  let session = 'off';
  if (mxHour >= 8 && mxHour < 12) session = 'asia_late';    // Cierre Tokyo
  else if (mxHour >= 9 && mxHour < 17) session = 'london_ny'; // NY + London overlap
  else if (mxHour >= 17 && mxHour < 21) session = 'evening';  // Post-NY
  else if (mxHour >= 21 || mxHour < 2) session = 'asia_early';
  else if (mxHour >= 2 && mxHour < 8) session = 'dead';       // Nadie operando

  return {
    ok: !isLowVolume,
    hour: mxHour,
    isLowVolume,
    isHighLiquidity,
    session,
    sessionLabel: {
      asia_late: 'Asia (cierre)',
      london_ny: 'NY + London',
      evening: 'Post-NY',
      asia_early: 'Asia (apertura)',
      dead: 'Bajo volumen',
      off: 'Fuera de horario',
    }[session] || session,
  };
}

// ── CONFLUENCIA DE ORDER BLOCKS MULTI-TF ─────────────────────
// Si el OB del 4h y el del 1h coinciden, la zona es MUY fuerte
export function multiTFBlockConfluence(blocksByTF) {
  if (!blocksByTF || Object.keys(blocksByTF).length < 2) return null;

  const tfOrder = ['1d', '4h', '1h', '15m'];
  const availableTFs = tfOrder.filter(tf => blocksByTF[tf]?.length > 0);

  if (availableTFs.length < 2) return null;

  // Buscar OBs que se superponen entre TFs
  const confluences = [];

  for (let i = 0; i < availableTFs.length; i++) {
    for (let j = i + 1; j < availableTFs.length; j++) {
      const tf1 = availableTFs[i];
      const tf2 = availableTFs[j];

      for (const ob1 of blocksByTF[tf1]) {
        for (const ob2 of blocksByTF[tf2]) {
          // ¿Se superponen?
          const overlapHigh = Math.min(ob1.high, ob2.high);
          const overlapLow = Math.max(ob1.low, ob2.low);

          if (overlapHigh >= overlapLow) {
            // Superposición = zona de confluencia
            const strength = (ob1.strength || 1) + (ob2.strength || 1);
            confluences.push({
              type: ob1.type === ob2.type ? ob1.type : 'mixed',
              high: overlapHigh,
              low: overlapLow,
              tfs: [tf1, tf2],
              strength: Math.min(strength, 10),
              isStrong: strength >= 4,
            });
          }
        }
      }
    }
  }

  // Ordenar por fuerza
  confluences.sort((a, b) => b.strength - a.strength);

  return confluences.length > 0 ? confluences[0] : null;
}

// ── INVALIDACIÓN DE SEÑAL ─────────────────────────────────────
// Si el precio ya pasó la zona de entrada, la señal es inválida
export function checkInvalidation(candles, direction, entryZone) {
  if (!candles || candles.length < 5 || !entryZone) return { valid: true };

  const recent = candles.slice(-10);
  const { high: zoneHigh, low: zoneLow } = entryZone;

  // Para LONG: si el precio ya subió mucho desde la zona, entrada mala
  if (direction === 'LONG') {
    const lastPrice = recent[recent.length - 1].close;
    const distanceAbove = (lastPrice - zoneHigh) / zoneHigh * 100;

    // Si ya subió más del 0.5% desde la zona, probablemente ya pasó
    if (distanceAbove > 0.5) {
      return {
        valid: false,
        reason: `precio ${distanceAbove.toFixed(2)}% encima de zona de entrada`,
        distancePct: distanceAbove,
      };
    }
  }

  // Para SHORT: si el precio ya bajó mucho desde la zona, entrada mala
  if (direction === 'SHORT') {
    const lastPrice = recent[recent.length - 1].close;
    const distanceBelow = (zoneLow - lastPrice) / zoneLow * 100;

    if (distanceBelow > 0.5) {
      return {
        valid: false,
        reason: `precio ${distanceBelow.toFixed(2)}% debajo de zona de entrada`,
        distancePct: distanceBelow,
      };
    }
  }

  // Verificar que no hubo una vela de rechazo fuerte en contra
  const lastCandle = recent[recent.length - 1];
  const bodySize = Math.abs(lastCandle.close - lastCandle.open);
  const totalRange = lastCandle.high - lastCandle.low;

  if (totalRange > 0) {
    const bodyRatio = bodySize / totalRange;

    // Vela de rechazo: mecha larga en contra de la dirección
    if (direction === 'LONG') {
      const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
      const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;

      if (lowerWick > bodySize * 2 && lowerWick > upperWick * 2) {
        return {
          valid: false,
          reason: 'vela de rechazo bajista detectada',
          rejectionType: 'bearish_rejection',
        };
      }
    }

    if (direction === 'SHORT') {
      const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
      const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;

      if (upperWick > bodySize * 2 && upperWick > lowerWick * 2) {
        return {
          valid: false,
          reason: 'vela de rechazo alcista detectada',
          rejectionType: 'bullish_rejection',
        };
      }
    }
  }

  return { valid: true };
}

// ── SCORE DINÁMICO ────────────────────────────────────────────
// Subir umbral en alta volatilidad (más ruido = más selectividad)
export function getDynamicMinScore(baseMinScore, candles) {
  if (!candles || candles.length < 20) return baseMinScore;

  // Calcular volatilidad reciente (ATR % promedio de últimas 20 velas)
  const ranges = candles.slice(-20).map(c => (c.high - c.low) / c.close * 100);
  const avgVolatility = ranges.reduce((a, b) => a + b, 0) / ranges.length;

  // Clasificar volatilidad
  let volLevel = 'normal';
  if (avgVolatility > 2.0) volLevel = 'high';
  else if (avgVolatility > 3.0) volLevel = 'extreme';
  else if (avgVolatility < 0.5) volLevel = 'low';

  // Ajustar score mínimo según volatilidad
  let adjustment = 0;
  switch (volLevel) {
    case 'high':     adjustment = 5;  break;  // Subir 5 pts
    case 'extreme':  adjustment = 10; break;  // Subir 10 pts
    case 'low':      adjustment = -3; break;  // Bajar 3 pts (mercado calmo = más confiable)
  }

  const dynamicScore = Math.max(50, Math.min(95, baseMinScore + adjustment));

  return {
    minScore: dynamicScore,
    baseMinScore,
    adjustment,
    volatility: Math.round(avgVolatility * 100) / 100,
    volLevel,
  };
}

// ── ANÁLISIS COMPLETO DE ESTRUCTURA ─────────────────────────
export function analyzeStructure(candles) {
  if (!candles || candles.length < 50) return null;

  const structure = detectBOS(candles);
  const blocks = detectOrderBlocks(candles);
  const fvgs = detectFVG(candles);
  const liquidity = detectLiquidityZones(candles);
  const pullback = detectPullback(candles, structure, blocks, fvgs);
  const zones = priceInZone(candles[candles.length - 1], blocks, fvgs);

  return {
    structure,
    blocks,
    fvgs,
    liquidity,
    pullback,
    inOB: zones.inOB,
    inFVG: zones.inFVG,
    hasStructure: !!structure,
    hasPullback: !!pullback,
    hasBOS: structure?.lastBOS || null,
  };
}
