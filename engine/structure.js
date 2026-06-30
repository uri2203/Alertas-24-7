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
