// ═══════════════════════════════════════════════════════════════
//  cycles.js  —  Time-Based Market Structure v8.0
//  Ciclicidad, estacionalidad, rotación de volumen, factor tiempo
//  "El tiempo marca el ritmo del cambio"
// ═══════════════════════════════════════════════════════════════

// ── DATOS ESTACIONALES HISTÓRICOS ────────────────────────────
// Basado en datos reales de crypto 2018-2025
// -1 = bajista, 0 = neutral, +1 = alcista
const SEASONALITY = {
  // BTC y cryptos generales
  BTCUSDT: {
    1:  0.3,   // Enero: profit-taking post-halving rally
    2:  0.5,   // Febrero: accumulation
    3: -0.2,   // Marzo: corrección fiscal
    4:  0.4,   // Abril: spring rally
    5:  0.1,   // Mayo: "sell in may" débil
    6: -0.3,   // Junio: summer lull
    7: -0.1,   // Julio: quiet
    8: -0.4,   // Agosto:所有人都 en vacaciones
    9: -0.5,   // Septiembre: peor mes históricamente
    10: 0.6,   // Octubre: Uptober
    11: 0.7,   // Noviembre: rally Navidad
    12: 0.2,   // Diciembre: profit-taking
  },
  ETHUSDT: {
    1:  0.4,   // Febrero de merge effect
    2:  0.6,
    3:  0.1,
    4:  0.5,
    5:  0.2,
    6: -0.2,
    7:  0.0,
    8: -0.3,
    9: -0.4,
    10: 0.7,   // ETH más volátil en Q4
    11: 0.8,
    12: 0.3,
  },
  SOLUSDT: {
    1:  0.5,
    2:  0.7,   // SOL más fuerte en Q1
    3:  0.3,
    4:  0.4,
    5:  0.1,
    6: -0.1,
    7: -0.2,
    8: -0.5,
    9: -0.6,
    10: 0.8,
    11: 0.9,   // SOL explosivo en Nov
    12: 0.4,
  },
  // Default para otras cryptos
  DEFAULT: {
    1:  0.3,
    2:  0.4,
    3:  0.0,
    4:  0.3,
    5:  0.1,
    6: -0.2,
    7: -0.1,
    8: -0.3,
    9: -0.4,
    10: 0.5,
    11: 0.6,
    12: 0.2,
  },
};

// ── CICLOS DE VOLUMEN (SEMANALES) ────────────────────────────
// Patrones de volumen por día de la semana (0=Dom, 6=Sáb)
const VOLUME_CYCLES = {
  0: 0.6,  // Domingo: bajo volumen
  1: 1.1,  // Lunes: apertura Asia → sube
  2: 1.2,  // Martes: London + NY overlap
  3: 1.0,  // Miércoles: medio
  4: 1.3,  // Jueves: opciones, derivatives
  5: 0.9,  // Viernes: cierre anticipado
  6: 0.5,  // Sábado: nadie
};

// ── CICLOS DE VOLATILIDAD (HORARIOS) ─────────────────────────
// Volatilidad relativa por hora MX (0-23)
const VOLATILITY_HOURS = {
  0: 0.4, 1: 0.3, 2: 0.2, 3: 0.2,  // Muerto
  4: 0.3, 5: 0.5, 6: 0.6, 7: 0.7,  // Asia late
  8: 0.9, 9: 1.2, 10: 1.3, 11: 1.2, // NY open
  12: 1.1, 13: 1.0, 14: 1.1, 15: 1.2, // NY afternoon
  16: 0.9, 17: 0.7, 18: 0.6, 19: 0.5, // Post-NY
  20: 0.4, 21: 0.5, 22: 0.6, 23: 0.5, // Asia early
};

// ── CICLOS DE BITCOIN (4 AÑOS) ───────────────────────────────
// Basado en halvings: 2020, 2024, 2028...
const BITCOIN_CYCLE = {
  postHalving: { months: [0, 1, 2, 3, 4, 5, 6], bias: 0.7 },    // 6 meses post-halving: alcista
  midCycle:    { months: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], bias: 0.3 }, // Medio ciclo: moderado
  preHalving:  { months: [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35], bias: -0.2 }, // Pre-halving: bajista
  bearMarket:  { months: [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47], bias: -0.5 }, // Bear market
};

// ── ANÁLISIS ESTACIONAL ──────────────────────────────────────
export function getSeasonality(symbol, month) {
  const key = symbol?.toUpperCase() || 'DEFAULT';
  const data = SEASONALITY[key] || SEASONALITY.DEFAULT;
  const bias = data[month] || 0;

  let label = 'neutral';
  if (bias >= 0.5) label = 'muy_alcista';
  else if (bias >= 0.2) label = 'alcista';
  else if (bias <= -0.5) label = 'muy_bajista';
  else if (bias <= -0.2) label = 'bajista';

  return { bias, label, month };
}

// ── ANÁLISIS DE CICLO SEMANAL ────────────────────────────────
export function getWeeklyCycle(date) {
  const day = date ? new Date(date).getDay() : new Date().getDay();
  const volume = VOLUME_CYCLES[day] || 1.0;

  let label = 'normal';
  if (volume >= 1.2) label = 'alta_liquidez';
  else if (volume >= 1.0) label = 'normal';
  else if (volume >= 0.7) label = 'baja_liquidez';
  else label = 'muerto';

  return { volume, label, day };
}

// ── ANÁLISIS DE CICLO HORARIO ────────────────────────────────
export function getHourlyCycle(mxHour) {
  const vol = VOLATILITY_HOURS[mxHour] || 0.5;

  let label = 'normal';
  if (vol >= 1.2) label = 'alta_volatilidad';
  else if (vol >= 1.0) label = 'normal';
  else if (vol >= 0.6) label = 'baja_volatilidad';
  else label = 'muerto';

  return { volatility: vol, label, hour: mxHour };
}

// ── CICLO DE BITCOIN (4 AÑOS) ────────────────────────────────
export function getBitcoinCycle(monthsSinceHalving) {
  if (monthsSinceHalving == null) return { bias: 0, label: 'desconocido', phase: 'unknown' };

  const m = monthsSinceHalving;

  for (const [phase, data] of Object.entries(BITCOIN_CYCLE)) {
    if (data.months.includes(m)) {
      let label = phase;
      if (phase === 'postHalving') label = 'post-halving (alcista)';
      else if (phase === 'midCycle') label = 'medio ciclo';
      else if (phase === 'preHalving') label = 'pre-halving (bajista)';
      else if (phase === 'bearMarket') label = 'bear market';

      return { bias: data.bias, label, phase, monthsInPhase: m };
    }
  }

  return { bias: 0, label: 'desconocido', phase: 'unknown' };
}

// ── DETECCIÓN DE ROTACIÓN DE VOLUMEN ─────────────────────────
// ¿El volumen se está moviendo de un activo a otro?
export function detectVolumeRotation(candlesBySymbol) {
  if (!candlesBySymbol || Object.keys(candlesBySymbol).length < 2) return null;

  const volumes = {};

  for (const [sym, candles] of Object.entries(candlesBySymbol)) {
    if (!candles || candles.length < 20) continue;

    const recent20 = candles.slice(-20);
    const avgVol = recent20.reduce((a, c) => a + (c.volume || 0), 0) / recent20.length;

    const recent5 = candles.slice(-5);
    const recentVol = recent5.reduce((a, c) => a + (c.volume || 0), 0) / recent5.length;

    volumes[sym] = {
      avg: avgVol,
      recent: recentVol,
      ratio: avgVol > 0 ? recentVol / avgVol : 1,
    };
  }

  // Encontrar símbolo con mayor incremento de volumen
  let maxRatio = 0;
  let rotationTarget = null;

  for (const [sym, vol] of Object.entries(volumes)) {
    if (vol.ratio > maxRatio) {
      maxRatio = vol.ratio;
      rotationTarget = sym;
    }
  }

  const isRotating = maxRatio > 1.5; // Volumen 50% superior al promedio

  return {
    isRotating,
    target: rotationTarget,
    maxRatio: Math.round(maxRatio * 100) / 100,
    volumes,
  };
}

// ── FACTOR TIEMPO EN SCORING ─────────────────────────────────
// Combina todos los factores temporales en un score
export function timeFactorScore(symbol, candles) {
  if (!candles || candles.length < 10) return { score: 50, reasons: [] };

  let score = 50; // Base neutral
  const reasons = [];
  const now = new Date();
  const mxHour = parseInt(now.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    hour: 'numeric',
    hour12: false,
  }));
  const month = now.getMonth() + 1;

  // 1. Estacionalidad del mes (±20 pts)
  const season = getSeasonality(symbol, month);
  const seasonPts = Math.round(season.bias * 20);
  score += seasonPts;
  if (seasonPts > 0) reasons.push(`estacional_${season.label}`);
  else if (seasonPts < 0) reasons.push(`estacional_${season.label}`);

  // 2. Ciclo semanal (±10 pts)
  const weekly = getWeeklyCycle(now);
  const weeklyPts = Math.round((weekly.volume - 1) * 10);
  score += weeklyPts;
  if (weekly.label === 'alta_liquidez') reasons.push('alta_liquidez_hoy');
  else if (weekly.label === 'muerto') reasons.push('bajo_volumen_hoy');

  // 3. Ciclo horario (±10 pts)
  const hourly = getHourlyCycle(mxHour);
  const hourlyPts = Math.round((hourly.volatility - 0.7) * 10);
  score += hourlyPts;
  if (hourly.label === 'alta_volatilidad') reasons.push('hora_alta_volatilidad');
  else if (hourly.label === 'muerto') reasons.push('hora_muerta');

  // 4. Análisis de volumen reciente vs histórico
  const recentVol = candles.slice(-5).reduce((a, c) => a + (c.volume || 0), 0) / 5;
  const histVol = candles.slice(-50).reduce((a, c) => a + (c.volume || 0), 0) / 50;
  const volRatio = histVol > 0 ? recentVol / histVol : 1;

  if (volRatio > 1.5) {
    score += 10;
    reasons.push('volumen_expansivo');
  } else if (volRatio < 0.5) {
    score -= 5;
    reasons.push('volumen_contractivo');
  }

  // 5. Posición en rango temporal (¿estamos en zona de acumulación o distribución?)
  // Si el precio sube con volumen alto = acumulación
  // Si el precio sube con volumen bajo = distribución
  const priceChange5 = (candles[candles.length - 1].close - candles[candles.length - 6].close) / candles[candles.length - 6].close;

  if (priceChange5 > 0.02 && volRatio > 1.2) {
    score += 10;
    reasons.push('acumulacion_detectada');
  } else if (priceChange5 > 0.02 && volRatio < 0.8) {
    score -= 10;
    reasons.push('distribucion_detectada');
  } else if (priceChange5 < -0.02 && volRatio > 1.2) {
    score -= 10;
    reasons.push('panic_selling');
  } else if (priceChange5 < -0.02 && volRatio < 0.8) {
    score += 5;
    reasons.push('capitulacion_silenciosa');
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    reasons,
    season,
    weekly,
    hourly,
    volRatio: Math.round(volRatio * 100) / 100,
    priceChange5: Math.round(priceChange5 * 10000) / 100,
  };
}

// ── MAPA COMPLETO DE CICLOS ──────────────────────────────────
export function fullCycleMap(symbol, candles) {
  const now = new Date();
  const mxHour = parseInt(now.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    hour: 'numeric',
    hour12: false,
  }));
  const month = now.getMonth() + 1;

  return {
    season: getSeasonality(symbol, month),
    weekly: getWeeklyCycle(now),
    hourly: getHourlyCycle(mxHour),
    timeScore: timeFactorScore(symbol, candles),
    timestamp: now.toISOString(),
  };
}
