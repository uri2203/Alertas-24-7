// ═══════════════════════════════════════════════════════════════
//  correlation.js  —  Cross-Asset Correlation Analysis v8.0
//  BTC Dominance, ETH/BTC ratio, correlation matrix
//  "Si BTC cae, todo cae — hay que saberlo antes"
// ═══════════════════════════════════════════════════════════════

// ── CORRELACIÓN ENTRE DOS SERIES DE PRECIOS ──────────────────
// Coeficiente de Pearson (-1 a +1)
export function pearsonCorrelation(x, y) {
  if (!x || !y || x.length !== y.length || x.length < 10) return 0;

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  return den === 0 ? 0 : num / den;
}

// ── CAMBIOS PORCENTUALES ─────────────────────────────────────
export function returns(closes) {
  if (!closes || closes.length < 2) return [];
  const r = [];
  for (let i = 1; i < closes.length; i++) {
    r.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return r;
}

// ── MATRIZ DE CORRELACIÓN ────────────────────────────────────
export function correlationMatrix(candlesBySymbol) {
  if (!candlesBySymbol || Object.keys(candlesBySymbol).length < 2) return null;

  const symbols = Object.keys(candlesBySymbol);
  const returnsBySymbol = {};

  // Calcular rendimientos para cada símbolo
  for (const sym of symbols) {
    const closes = candlesBySymbol[sym]?.map(c => c.close) || [];
    returnsBySymbol[sym] = returns(closes);
  }

  // Encontrar longitud mínima
  const minLen = Math.min(...Object.values(returnsBySymbol).map(r => r.length));
  if (minLen < 10) return null;

  // Construir matriz
  const matrix = {};
  for (const sym1 of symbols) {
    matrix[sym1] = {};
    for (const sym2 of symbols) {
      if (sym1 === sym2) {
        matrix[sym1][sym2] = 1;
      } else {
        const r1 = returnsBySymbol[sym1].slice(-minLen);
        const r2 = returnsBySymbol[sym2].slice(-minLen);
        matrix[sym1][sym2] = Math.round(pearsonCorrelation(r1, r2) * 100) / 100;
      }
    }
  }

  return matrix;
}

// ── BTC DOMINANCE PROXY ──────────────────────────────────────
// No necesitamos API de CoinGecko — calculamos dominancia relativa
// Comparando performance de BTC vs el promedio del mercado
export function btcDominanceProxy(candlesBySymbol) {
  if (!candlesBySymbol?.BTCUSDT) return null;

  const btcReturns = returns(candlesBySymbol.BTCUSDT.map(c => c.close));
  if (btcReturns.length < 10) return null;

  // Promedio de rendimientos del mercado (excluyendo BTC)
  const altSymbols = Object.keys(candlesBySymbol).filter(s => s !== 'BTCUSDT');
  if (altSymbols.length === 0) return null;

  const altAvgReturns = [];
  for (let i = 0; i < Math.min(20, btcReturns.length); i++) {
    let sum = 0;
    let count = 0;
    for (const sym of altSymbols) {
      const r = returns(candlesBySymbol[sym]?.map(c => c.close));
      if (r.length > i) {
        sum += r[r.length - 1 - i];
        count++;
      }
    }
    if (count > 0) altAvgReturns.push(sum / count);
  }

  if (altAvgReturns.length < 5) return null;

  // BTC vs mercado: positivo = BTC lidera, negativo = altcoins lideran
  const btcRecent = btcReturns.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const altRecent = altAvgReturns.slice(0, 5).reduce((a, b) => a + b, 0) / 5;

  const dominance = btcRecent - altRecent;

  // Clasificar régimen
  let regime = 'neutral';
  if (dominance > 0.01) regime = 'btc_leading';      // BTC superando al mercado
  else if (dominance < -0.01) regime = 'altcoins_leading'; // Altcoins superando a BTC
  else regime = 'correlated';                          // Movimiento similar

  return {
    dominance: Math.round(dominance * 10000) / 100, // En basis points
    regime,
    btcRecent: Math.round(btcRecent * 10000) / 100,
    altRecent: Math.round(altRecent * 10000) / 100,
  };
}

// ── ETH/BTC RATIO ────────────────────────────────────────────
// Si ETH/BTC sube = altcoins fuertes
// Si ETH/BTC baja = altcoins débiles
export function ethBtcRatio(candlesBySymbol) {
  if (!candlesBySymbol?.ETHUSDT || !candlesBySymbol?.BTCUSDT) return null;

  const ethCloses = candlesBySymbol.ETHUSDT.map(c => c.close);
  const btcCloses = candlesBySymbol.BTCUSDT.map(c => c.close);

  const minLen = Math.min(ethCloses.length, btcCloses.length);
  if (minLen < 20) return null;

  const ratio = ethCloses[minLen - 1] / btcCloses[minLen - 1];
  const ratioPrev = ethCloses[minLen - 6] / btcCloses[minLen - 6];

  const ratioChange = (ratio - ratioPrev) / ratioPrev * 100;

  let trend = 'neutral';
  if (ratioChange > 2) trend = 'altcoins_strong';
  else if (ratioChange < -2) trend = 'altcoins_weak';
  else trend = 'stable';

  return {
    ratio: Math.round(ratio * 10000) / 10000,
    ratioChange: Math.round(ratioChange * 100) / 100,
    trend,
    signal: trend === 'altcoins_strong' ? 'favor_altcoins' : trend === 'altcoins_weak' ? 'favor_btc' : 'neutral',
  };
}

// ── DETECCIÓN DE SEÑALES REDUNDANTES ─────────────────────────
// Si ETH y SOL están 90% correlacionados, no enviar ambos
export function detectRedundantSignals(signals, matrix) {
  if (!signals || signals.length < 2 || !matrix) return signals;

  const redundant = new Set();
  const filtered = [];

  for (let i = 0; i < signals.length; i++) {
    const sig1 = signals[i];
    if (redundant.has(sig1.sym)) continue;

    let isRedundant = false;

    for (let j = i + 1; j < signals.length; j++) {
      const sig2 = signals[j];

      // Misma dirección + alta correlación = redundante
      const corr = matrix[sig1.sym]?.[sig2.sym] || 0;
      if (sig1.direction === sig2.direction && corr > 0.8) {
        // Mantener la de mayor score
        if (sig1.score >= sig2.score) {
          redundant.add(sig2.sym);
          console.log(`   [CORR] ${sig2.sym} redundante con ${sig1.sym} (corr: ${corr})`);
        } else {
          isRedundant = true;
          break;
        }
      }
    }

    if (!isRedundant) filtered.push(sig1);
  }

  return filtered;
}

// ── ANÁLISIS COMPLETO DE CORRELACIÓN ─────────────────────────
export function analyzeCorrelation(candlesBySymbol, candidates) {
  if (!candlesBySymbol || Object.keys(candlesBySymbol).length < 2) {
    return { matrix: null, dominance: null, ethBtc: null, filtered: candidates || [] };
  }

  const matrix = correlationMatrix(candlesBySymbol);
  const dominance = btcDominanceProxy(candlesBySymbol);
  const ethBtc = ethBtcRatio(candlesBySymbol);

  // Filtrar candidatos redundantes
  let filtered = candidates || [];
  if (matrix && filtered.length > 1) {
    filtered = detectRedundantSignals(filtered, matrix);
  }

  // Penalizar señales de altcoins si BTC está débil
  if (dominance?.regime === 'btc_leading' && dominance.dominance > 2) {
    filtered = filtered.map(c => {
      if (c.sym !== 'BTCUSDT' && c.direction === 'LONG') {
        return { ...c, score: c.score - 10, penalty: 'btc_dominance_weak' };
      }
      return c;
    });
  }

  // Bonus si ETH/BTC confirma dirección altcoins
  if (ethBtc?.signal === 'favor_altcoins') {
    filtered = filtered.map(c => {
      if (c.sym !== 'BTCUSDT' && c.direction === 'LONG') {
        return { ...c, score: Math.min(100, c.score + 5), bonus: 'eth_btc_confirm' };
      }
      return c;
    });
  }

  return {
    matrix,
    dominance,
    ethBtc,
    filtered,
    stats: {
      symbolsAnalyzed: Object.keys(candlesBySymbol).length,
      correlationsFound: matrix ? Object.values(matrix).flat().filter(v => v > 0.7).length / 2 : 0,
    },
  };
}
