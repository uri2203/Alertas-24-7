// ═══════════════════════════════════════════════════════════════
//  engine/scanner.js  —  Trading Dashboard PRO v8.0
//  Motor de Escaneo Autónomo 24/7 — Structure-Based Trading
// ═══════════════════════════════════════════════════════════════
import { detectNews, newsSLTPAdjustment } from './news.js';
import { scoreSignal, TF_CONFIG, TF_PARENT } from './signals.js';
import { sendTelegram, buildAlertMessage }    from './telegram.js';
import { trackSignal, evaluatePending }       from './tracker.js';
import { detectRegime, regimeScoreAdjustment } from './regime.js';
import { extractFeatures, LogisticClassifier } from './ml.js';
import { calcPositionSize, kellyFraction } from './risk.js';
import { geneticOptimize } from './optimizer.js';
import { agentPredict, trainFromHistory, trainOnWinners, trainOnNews, getAgentStats, exportQTable, importQTable, liveLearn, getAgentLiveStatus } from './agent.js';
import { analyzeMultiTF, complementaryIndicators, structureScore } from './confluence.js';
import { checkSpread, checkTimeFilter, multiTFBlockConfluence, checkInvalidation, getDynamicMinScore } from './structure.js';
import { analyzeCorrelation } from './correlation.js';
import { canOpenPosition, managePosition, getPositionStats } from './position.js';
import { checkPortfolioRisk, registerPosition, registerPositionClose, checkEmergencyStop, getPortfolioSummary, resetDaily } from './portfolio.js';
import { logTrade, closeTrade, getJournalStats, getRecentTrades } from './journal.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const STATE = {
  signals:      {},
  prices:       {},
  lastScan:     null,
  daemonActive: false,
  isScanning:   false,
  paused:       false,
  scanCount:    0,
  errors:       [],
  session:      null,
  ml:           { trained: false, confidence: 0, filtered: 0, total: 0, correct: 0 },
  regime:       { trending: 0, ranging: 0, volatile: 0, blocked: 0 },
  optimizer:    { optimized: 0, lastRun: null },
  agent:        { trained: false, decisions: 0, skipped: 0, traded: 0 },
  structure:    { elite: 0, strong: 0, moderate: 0, weak: 0, filtered: 0 },
  optimizedParams: {},
};

const alertCooldown  = {};
const lastDirSent    = {};
const mayorCache     = {};
const MAYOR_CACHE_MS = 3 * 60 * 1000;
const ANTI_CONTRA_MS = 4 * 60 * 60 * 1000; // 4 horas (calidad > cantidad)
const OPT_RETRAIN_MS = 6 * 60 * 60 * 1000;

// ═══ CONFIGURACIÓN DE CALIDAD ══════════════════════════════════
const MIN_QUALITY = 'strong';  // 'elite' (85+) o 'strong' (70+)
const MIN_SCORE_STRUCTURE = 85; // Solo señales ELITE (subió de 70)
const BEST_OF_CYCLE = true;    // Solo la señal #1 por escaneo

// ── ML CLASSIFIER GLOBAL ─────────────────────────────────────────
let mlClassifier = new LogisticClassifier();
let mlTrainData  = [];

// ── CARGAR PARAMETROS OPTIMIZADOS ────────────────────────────────
function loadOptimizedParams() {
  try {
    const optAllPath = join(DATA_DIR, 'opt-all.json');
    if (existsSync(optAllPath)) {
      const data = JSON.parse(readFileSync(optAllPath, 'utf8'));
      if (data.results) {
        for (const [sym, val] of Object.entries(data.results)) {
          for (const [tf, gene] of Object.entries(val)) {
            STATE.optimizedParams[`${sym}-${tf}`] = gene;
          }
        }
        console.log(`[OPT] Cargados ${Object.keys(STATE.optimizedParams).length} conjuntos de parametros optimizados`);
      }
    }
  } catch {}
}

function getOptimizedWeights(sym, tf) {
  const key = `${sym}-${tf}`;
  const gene = STATE.optimizedParams[key];
  if (!gene) return null;
  // Convertir gene del optimizador a weights del scorer
  return {
    ema: gene.wEma || 1.0,
    fld: gene.wFld || 2.0,
    macd: gene.wMacd || 2.0,
    adx: gene.wAdx || 1.5,
    rsiVol: gene.wRsiVol || 1.5,
    obv: gene.wObv || 1.0,
    elliott: gene.wElliott || 1.0,
    fib: gene.wFib || 1.0,
    pivot: gene.wPivot || 1.0,
    tfMayor: gene.wTfMayor || 1.0,
    rr: gene.wRR || 1.0,
    regime: 1.0,
    mlConf: 1.0,
  };
}

// ── CORRELACION ──────────────────────────────────────────────────
const CORR_GROUPS = [
  ['BTCUSDT'],
  ['ETHUSDT'],
  ['SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'DOGEUSDT', 'XRPUSDT'],
  ['LINKUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'NEARUSDT'],
];
const sentThisCycle = new Map();

// ── SESION ACTIVA ────────────────────────────────────────────────
function getSession() {
  const mxStr  = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
  const mxDate = new Date(mxStr);
  const h      = mxDate.getHours() + mxDate.getMinutes() / 60;

  if (h >= 8  && h < 12) return { name: 'Manana', minScore: 8.5, cooldownMs: 4 * 60 * 60 * 1000 }; // 4 horas
  if (h >= 12 && h < 14) return { name: 'Mediodia', minScore: 9.0, cooldownMs: 4 * 60 * 60 * 1000 };
  if (h >= 14 && h < 18) return { name: 'Tarde',  minScore: 8.5, cooldownMs: 4 * 60 * 60 * 1000 };
  if (h >= 18 && h < 20) return { name: 'Atardecer', minScore: 9.0, cooldownMs: 4 * 60 * 60 * 1000 };
  if (h >= 20 && h < 24) return { name: 'Noche',  minScore: 9.0, cooldownMs: 4 * 60 * 60 * 1000 };
  if (h >= 0  && h < 8)  return { name: 'Madrugada', minScore: 9.5, cooldownMs: 4 * 60 * 60 * 1000 };
  return null;
}

// ── FILTRO ANTI-CONTRADICCION ────────────────────────────────────
function isContradicted(sym, dir) {
  const last = lastDirSent[sym];
  if (!last) return false;
  return last.dir !== dir && Date.now() - last.time < ANTI_CONTRA_MS;
}

function registerSent(sym, dir) {
  lastDirSent[sym] = { dir, time: Date.now() };
}

// ── FETCH CANDLES ────────────────────────────────────────────────
export async function fetchCandles(symbol, interval, limit = 500) {
  const endpoints = [
    'https://data-api.binance.vision/api/v3/klines',
    'https://api1.binance.com/api/v3/klines',
    'https://api2.binance.com/api/v3/klines',
    'https://api3.binance.com/api/v3/klines',
  ];
  let lastError;
  for (const base of endpoints) {
    try {
      const url = `${base}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Server Daemon)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.map(k => ({
        time: +k[0] / 1000,
        open: +k[1], high: +k[2], low: +k[3], close: +k[4], vol: +k[5],
      }));
    } catch (e) { lastError = e; }
  }
  throw lastError;
}

// ── CANDLES TF MAYOR con cache ───────────────────────────────────
async function getMayorCandles(symbol, tf) {
  const parentTf = TF_PARENT[tf];
  if (!parentTf) return null;
  const cacheKey = `${symbol}-${parentTf}`;
  const cached   = mayorCache[cacheKey];
  if (cached && Date.now() - cached.ts < MAYOR_CACHE_MS) return cached.candles;
  try {
    const candles = await fetchCandles(symbol, parentTf, 200);
    mayorCache[cacheKey] = { candles, ts: Date.now() };
    return candles;
  } catch (e) {
    console.error(`   [ERR] TF Mayor ${symbol}/${parentTf}: ${e.message}`);
    return null;
  }
}

// ── ML: ENTRENAR CON DATOS HISTORICOS ────────────────────────────
async function trainMLClassifier(config) {
  console.log('[ML] Entrenando clasificador con datos historicos...');
  let totalSamples = 0;
  const trainData = [];

  for (const sym of config.symbols) {
    for (const tf of config.tfs) {
      // Ignorar TFs menores a 1h (demasiado ruido)
      if (tf === '1m' || tf === '5m' || tf === '15m') continue;
      try {
        const candles = await fetchCandles(sym, tf, 500);
        if (!candles || candles.length < 250) continue;

        const WINDOW = 200;
        for (let i = WINDOW; i < candles.length - 50; i += 10) {
          const window = candles.slice(0, i + 1);
          const sig = await scoreSignal(window, tf, TF_CONFIG);
          if (!sig || sig.signal === 'WAIT') continue;

          const features = extractFeatures(window, tf);
          if (!features) continue;

          const entryPrice = candles[i].close;
          const atr = sig.atr || 1;
          const future = candles.slice(i + 1, i + 51);
          if (future.length < 10) continue;

          let won = false;
          const sl = sig.signal === 'LONG' ? entryPrice - atr * 2 : entryPrice + atr * 2;
          const tp = sig.signal === 'LONG' ? entryPrice + atr * 2 : entryPrice - atr * 2;

          for (const fc of future) {
            if (sig.signal === 'LONG') {
              if (fc.low <= sl) { won = false; break; }
              if (fc.high >= tp) { won = true; break; }
            } else {
              if (fc.high >= sl) { won = false; break; }
              if (fc.low <= tp) { won = true; break; }
            }
          }
          if (!future.some(fc =>
            (sig.signal === 'LONG' && (fc.low <= sl || fc.high >= tp)) ||
            (sig.signal === 'SHORT' && (fc.high >= sl || fc.low <= tp))
          )) {
            const lastPrice = future[future.length - 1].close;
            won = sig.signal === 'LONG' ? lastPrice > entryPrice : lastPrice < entryPrice;
          }

          trainData.push({ features, label: won ? 1 : 0 });
          totalSamples++;
        }
        await new Promise(r => setTimeout(r, 300));
      } catch (e) { /* skip */ }
    }
  }

  if (trainData.length >= 20) {
    const X = trainData.map(d => d.features);
    const y = trainData.map(d => d.label);
    mlClassifier.train(X, y, 300, 0.01);
    STATE.ml.trained = true;
    const accuracy = mlClassifier.evaluate(X, y);
    console.log(`[ML] Entrenado con ${totalSamples} muestras. Accuracy: ${(accuracy * 100).toFixed(1)}%`);
  } else {
    console.log(`[ML] Insuficientes muestras (${totalSamples}). ML desactivado.`);
  }

  // ── ENTRENAR RL AGENT ──────────────────────────────────────────
  console.log('[AGENT] Entrenando agente RL con historial...');
  try {
    // Recopilar trades historicos para entrenar al agente
    const allTrades = [];
    const candlesCache = {};
    for (const sym of config.symbols) {
      for (const tf of config.tfs) {
        // Ignorar TFs menores a 1h (demasiado ruido)
        if (tf === '1m' || tf === '5m' || tf === '15m') continue;
        const key = `${sym}-${tf}`;
        try {
          const candles = await fetchCandles(sym, tf, 500);
          if (!candles || candles.length < 200) continue;
          candlesCache[key] = candles;

          // Simular señales históricas para generar training data
          const WINDOW = 200;
          for (let i = WINDOW; i < candles.length - 50; i += 10) {
            const window = candles.slice(0, i + 1);
            const sig = await scoreSignal(window, tf, TF_CONFIG);
            if (!sig || sig.signal === 'WAIT') continue;

            const entryPrice = candles[i].close;
            const atr = sig.atr || 1;
            const future = candles.slice(i + 1, i + 51);
            if (future.length < 10) continue;

            let won = false;
            const sl = sig.signal === 'LONG' ? entryPrice - atr * 2 : entryPrice + atr * 2;
            const tp = sig.signal === 'LONG' ? entryPrice + atr * 2 : entryPrice - atr * 2;

            for (const fc of future) {
              if (sig.signal === 'LONG') {
                if (fc.low <= sl) { won = false; break; }
                if (fc.high >= tp) { won = true; break; }
              } else {
                if (fc.high >= sl) { won = false; break; }
                if (fc.low <= tp) { won = true; break; }
              }
            }
            if (!future.some(fc =>
              (sig.signal === 'LONG' && (fc.low <= sl || fc.high >= tp)) ||
              (sig.signal === 'SHORT' && (fc.high >= sl || fc.low <= tp))
            )) {
              const lastPrice = future[future.length - 1].close;
              won = sig.signal === 'LONG' ? lastPrice > entryPrice : lastPrice < entryPrice;
            }

            allTrades.push({
              sym, tf,
              entryTime: candles[i].time,
              result: won ? 'WIN' : 'LOSS',
              pnl: won ? 0.02 : -0.01,
            });
          }
          await new Promise(r => setTimeout(r, 300));
        } catch {}
      }
    }

    // Entrenar agente
    const agentResult = trainFromHistory(allTrades, candlesCache);
    if (agentResult) {
      STATE.agent.trained = true;
      console.log(`[AGENT] Entrenado: ${agentResult.episodes} episodes, skip=${agentResult.skipAccuracy}%, trade=${agentResult.tradeAccuracy}%`);
      if (agentResult.bigWins) console.log(`[AGENT] Big wins: ${agentResult.bigWins}, Big losses: ${agentResult.bigLosses}`);
      if (agentResult.newsTrades) console.log(`[AGENT] News trades detectados: ${agentResult.newsTrades}`);
    }

    // Entrenar en trades ganadores REALES (el tiburón aprende de sus presas)
    const winningTrades = allTrades.filter(t => t.result === 'WIN' && t.pnl >= 0.03);
    if (winningTrades.length > 0) {
      const hunterResult = trainOnWinners(winningTrades, candlesCache);
      if (hunterResult) {
        console.log(`[HUNTER] Entrenado en ${hunterResult.winners} trades ganadores (+3%+). Sample: ${hunterResult.trainedOn}`);
      }
    }

    // Entrenar en trades de NOTICIAS (el tiburón de élite caza en tormentas)
    const { detectNews } = await import('./news.js');
    const newsTrades = [];
    for (const trade of allTrades) {
      const key = `${trade.sym}-${trade.tf}`;
      const candles = candlesCache[key];
      if (!candles || candles.length < 200) continue;
      const entryIdx = candles.findIndex(c => c.time >= trade.entryTime);
      if (entryIdx < 200) continue;
      const news = detectNews(candles.slice(0, entryIdx + 1));
      if (news.score >= 25) {
        newsTrades.push({ ...trade, newsScore: news.score });
      }
    }
    if (newsTrades.length > 0) {
      const eliteResult = trainOnNews(newsTrades, candlesCache);
      if (eliteResult) {
        console.log(`[ELITE] Entrenado en ${eliteResult.newsTrades} trades de noticias. Sample: ${eliteResult.trainedOn}`);
      }
    }

    // Cargar Q-table guardada si existe
    const qTablePath = join(DATA_DIR, 'agent-qtable.json');
    if (existsSync(qTablePath)) {
      const data = JSON.parse(readFileSync(qTablePath, 'utf8'));
      importQTable(data);
      console.log(`[AGENT] Q-table cargada: ${data.episodeCount} episodes`);
    }
  } catch (e) {
    console.error('[AGENT] Error entrenando:', e.message);
  }
}

// ── AUTO-OPTIMIZER: optimizar parametros periodicamente ───────────
async function autoOptimize(config) {
  console.log('[OPT] Auto-optimizacion iniciada...');
  const pairsToOptimize = config.symbols.slice(0, 4); // Top 4 symols

  for (const sym of pairsToOptimize) {
    for (const tf of ['1h', '4h']) {
      try {
        const candles = await fetchCandles(sym, tf, 1000);
        if (!candles || candles.length < 300) continue;

        console.log(`[OPT] Optimizando ${sym} ${tf}...`);
        const result = geneticOptimize(candles, tf, { popSize: 15, generations: 10 });

        const key = `${sym}-${tf}`;
        STATE.optimizedParams[key] = result.bestGene;
        STATE.optimizer.optimized++;
        STATE.optimizer.lastRun = new Date().toISOString();

        console.log(`[OPT] ${sym} ${tf}: fitness=${result.bestFitness.toFixed(4)}`);
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error(`[OPT] Error ${sym}/${tf}: ${e.message}`);
      }
    }
  }

  // Guardar todos los parametros optimizados
  try {
    const outPath = join(DATA_DIR, 'opt-all.json');
    writeFileSync(outPath, JSON.stringify({
      results: STATE.optimizedParams,
      tf: 'multi',
      timestamp: new Date().toISOString(),
    }, null, 2), 'utf8');
    console.log(`[OPT] Parametros guardados en opt-all.json`);
  } catch {}

  console.log(`[OPT] Auto-optimizacion completada: ${STATE.optimizer.optimized} conjuntos`);
}

// ── CICLO DE ESCANEO ─────────────────────────────────────────────
async function runCycle(config) {
  if (STATE.isScanning) return;

  if (STATE.paused) {
    STATE.session = 'Pausado';
    console.log('[SCANNER] Pausado - evaluando resultados pendientes...');
    await evaluatePending(fetchCandles).catch(() => {});
    return;
  }

  const session = getSession();
  STATE.session = session ? session.name : 'Fuera de horario';
  if (!session) {
    console.log('[SCANNER] Fuera de horario.');
    await evaluatePending(fetchCandles).catch(() => {});
    return;
  }

  STATE.isScanning = true;
  STATE.scanCount++;
  STATE.lastScan = new Date().toISOString();

  // ═══ EMERGENCY STOP ════════════════════════════════════════════
  const emergency = checkEmergencyStop();
  if (emergency.shouldStop) {
    console.log(`\n[EMERGENCY] SISTEMA PAUSADO:`);
    emergency.reasons.forEach(r => console.log(`   ❌ ${r.type}: ${r.message}`));
    STATE.isScanning = false;
    return;
  }

  // ═══ UMBRAL ADAPTATIVO ═════════════════════════════════════════
  // Ajustar MIN_SCORE según win rate reciente
  const journalStats = getJournalStats();
  let adaptiveMinScore = MIN_SCORE_STRUCTURE;
  if (journalStats.totalTrades >= 10) {
    if (journalStats.winRate >= 70) {
      adaptiveMinScore = Math.max(80, MIN_SCORE_STRUCTURE - 5); // Más agresivo si gana
    } else if (journalStats.winRate < 50) {
      adaptiveMinScore = Math.min(95, MIN_SCORE_STRUCTURE + 5); // Más conservador si pierde
    }
  }

  console.log(`\n[SCAN #${STATE.scanCount}] Sesion: ${session.name} | Calidad>=${adaptiveMinScore}/100 | ML: ${STATE.ml.trained ? 'ON' : 'OFF'} | WinRate: ${journalStats.winRate || 0}%`);

  const activeThisCycle = new Set();
  sentThisCycle.clear();

  // ═══ CANDIDATOS DEL CICLO (para best-of-cycle) ════════════════
  const candidates = [];

  for (const sym of config.symbols) {
    try {
      // ═══ OBTENER CANDLES DE MÚLTIPLES TFs ═══════════════════
      const candlesByTF = {};
      for (const tf of config.tfs) {
        // Ignorar TFs menores a 1h (demasiado ruido)
        if (tf === '1m' || tf === '5m' || tf === '15m') continue;
        const candles = await fetchCandles(sym, tf);
        if (candles && candles.length >= 50) {
          candlesByTF[tf] = candles;
          if (tf === '1h' || tf === config.tfs[0]) {
            STATE.prices[sym] = candles[candles.length - 1].close;
          }
        }
        await new Promise(r => setTimeout(r, 200));
      }

      if (Object.keys(candlesByTF).length < 2) continue;

      // ═══ FILTRO 1: TIME FILTER (evitar bajo volumen) ═══════════
      const timeFilter = checkTimeFilter();
      if (!timeFilter.ok) {
        console.log(`   [TIME] ${sym} — ${timeFilter.sessionLabel} (${timeFilter.hour}h)`);
        continue;
      }

      // ═══ FILTRO 2: SPREAD FILTER ══════════════════════════════
      const entryTF = Object.keys(candlesByTF).pop();
      const spreadCheck = checkSpread(candlesByTF[entryTF]);
      if (!spreadCheck.ok) {
        console.log(`   [SPREAD] ${sym} — spread ${spreadCheck.spread}% > ${spreadCheck.maxSpreadPct}%`);
        continue;
      }

      // ═══ FILTRO 3: DYNAMIC SCORE (volatilidad) ════════════════
      const dynamicScore = getDynamicMinScore(adaptiveMinScore, candlesByTF[entryTF]);

      // ═══ ANÁLISIS DE ESTRUCTURA MULTI-TF ═══════════════════════
      const multiTF = analyzeMultiTF(candlesByTF);
      if (!multiTF || multiTF.percentage < dynamicScore.minScore) {
        if (multiTF) {
          STATE.structure[multiTF.quality]++;
          if (multiTF.percentage < dynamicScore.minScore) STATE.structure.filtered++;
        }
        continue;
      }

      // ═══ INDICADORES COMPLEMENTARIOS ═══════════════════════════
      const indicators = complementaryIndicators(candlesByTF[entryTF]);

      // ═══ SCORING FINAL ═════════════════════════════════════════
      const structResult = structureScore(multiTF, indicators, sym, candlesByTF[entryTF]);

      // Solo calidad 'strong' o 'elite'
      if (structResult.quality !== 'strong' && structResult.quality !== 'elite') {
        STATE.structure[structResult.quality]++;
        STATE.structure.filtered++;
        console.log(`   [STRUCT] ${sym} ${structResult.quality} (${structResult.score}/100) — filtrado`);
        continue;
      }

      STATE.structure[structResult.quality]++;

      // ═══ FILTRO 4: INVALIDATION CHECK ═════════════════════════
      // Verificar que el precio no ya pasó la zona de entrada
      if (multiTF.pullbackSetup) {
        const obBlocks = [];
        for (const [tf, candles] of Object.entries(candlesByTF)) {
          const struct = analyzeStructure(candles);
          if (struct?.blocks) obBlocks.push(...struct.blocks);
        }

        const pullbackZone = multiTF.pullbackSetup;
        const invalidation = checkInvalidation(
          candlesByTF[entryTF],
          structResult.direction,
          { high: pullbackZone.zonePrice?.split('-')[1] || 0, low: pullbackZone.zonePrice?.split('-')[0] || 0 }
        );

        if (!invalidation.valid) {
          console.log(`   [INVALID] ${sym} — ${invalidation.reason}`);
          continue;
        }
      }

      // ═══ FILTRO 5: MULTI-TF OB CONFLUENCE ═════════════════════
      // Si hay OB coincidente entre TFs = zona MUY fuerte
      const blocksByTF = {};
      for (const [tf, candles] of Object.entries(candlesByTF)) {
        const struct = analyzeStructure(candles);
        if (struct?.blocks) blocksByTF[tf] = struct.blocks;
      }
      const obConfluence = multiTFBlockConfluence(blocksByTF);
      if (obConfluence?.isStrong) {
        // Bonus de score por confluencia de OB
        structResult.score = Math.min(100, structResult.score + 5);
        reasons.push('ob_confluence_multi_tf');
      }

      // ═══ FILTROS ADICIONALES ══════════════════════════════════

      // Anti-contradicción
      if (isContradicted(sym, structResult.direction)) {
        const last = lastDirSent[sym];
        const restMin = Math.ceil((ANTI_CONTRA_MS - (Date.now() - last.time)) / 60000);
        console.log(`   [ANTI-CONTRA] ${sym} ${structResult.direction} bloqueado (espera ${restMin} min)`);
        continue;
      }

      // Correlación
      const group = CORR_GROUPS.find(g => g.includes(sym)) || [sym];
      const groupKey = group.sort().join('-');
      const existing = sentThisCycle.get(groupKey);
      if (existing && existing.dir === structResult.direction) {
        if (structResult.score - existing.score < 10) {
          console.log(`   [CORR] ${sym} descartada, ${existing.sym} ya tiene ${existing.dir} (${existing.score} vs ${structResult.score})`);
          continue;
        }
      }
      sentThisCycle.set(groupKey, { dir: structResult.direction, score: structResult.score, sym });

      // RL Agent — MODO ELITE HUNTER
      STATE.agent.decisions++;
      const entryCandles = candlesByTF[entryTF];
      let agentSizing = null;
      let newsContext = null;

      // Detectar noticia en el momento actual
      if (entryCandles) {
        newsContext = detectNews(entryCandles);
        if (newsContext.score >= 10) {
          console.log(`   [NEWS] ${sym} — Score: ${newsContext.score}/100 (${newsContext.level}) | Dir: ${newsContext.direction} | Vol: ${newsContext.volRatio}x`);
        }
      }

      if (STATE.agent.trained && entryCandles) {
        const agentDec = agentPredict(entryCandles, newsContext?.score || 0);

        // Filtro de confianza mínima: solo trades con >75% confianza
        if (agentDec.action === 'SKIP' || agentDec.confidence < 0.75) {
          STATE.agent.skipped++;
          console.log(`   [AGENT] ${sym} SKIP (${(agentDec.confidence * 100).toFixed(0)}%) — ${agentDec.riskLevel}`);
          continue;
        }
        STATE.agent.traded++;
        agentSizing = agentDec.sizing;
        console.log(`   [AGENT] ${sym} TRADE — confidence: ${(agentDec.confidence * 100).toFixed(0)}% | sizing: ${agentDec.sizing.label} (${agentDec.sizing.multiplier}x) | ${agentDec.riskLevel}`);
      }

      // ═══ FILTRO PORTFOLIO: Verificar riesgo total ═══════════════
      const agentConfidence = agentSizing ? (agentSizing.multiplier / 3) : 0.5;
      const portfolioRisk = checkPortfolioRisk(
        sym,
        structResult.direction,
        agentSizing?.multiplier || 1,
        STATE.prices[sym] || 0
      );

      if (!portfolioRisk.allowed) {
        portfolioRisk.risks.forEach(r => {
          console.log(`   [PORTFOLIO] ${sym} — ${r.type}: ${r.message}`);
        });
        continue;
      }

      // ═══ CANDIDATO VÁLIDO ═════════════════════════════════════
      candidates.push({
        sym,
        direction: structResult.direction,
        score: structResult.score,
        quality: structResult.quality,
        reasons: structResult.reasons,
        multiTF,
        indicators,
        entryTF,
        candles: entryCandles,
        agentSizing,
        newsContext,
        agentConfidence,
      });

      console.log(`   [STRUCT] ${sym} ${structResult.direction} ${structResult.score}/100 (${structResult.quality}) — ${structResult.reasons.join(', ')}${obConfluence?.isStrong ? ' [OB CONFLUENCE]' : ''}`);

    } catch (e) {
      STATE.errors.push({ sym, error: e.message, time: new Date().toISOString() });
    }
  }

  // ═══ ANÁLISIS DE CORRELACIÓN ════════════════════════════════════
  // Construir candlesBySymbol para análisis de correlación
  const candlesBySymbol = {};
  for (const cand of candidates) {
    if (!candlesBySymbol[cand.sym]) candlesBySymbol[cand.sym] = cand.candles;
  }

  const corrAnalysis = analyzeCorrelation(candlesBySymbol, candidates);
  candidates = corrAnalysis.filtered;

  if (corrAnalysis.dominance) {
    console.log(`   [CORR] BTC dominance: ${corrAnalysis.dominance.dominance} bps (${corrAnalysis.dominance.regime})`);
  }
  if (corrAnalysis.ethBtc) {
    console.log(`   [CORR] ETH/BTC: ${corrAnalysis.ethBtc.ratio} (${corrAnalysis.ethBtc.signal})`);
  }

  // ═══ LÍMITE DE POSICIONES ══════════════════════════════════════
  const posCheck = canOpenPosition(3); // Máximo 3 posiciones abiertas
  if (!posCheck.canOpen) {
    console.log(`[SCAN #${STATE.scanCount}] Límite de posiciones alcanzado (${posCheck.openCount}/${posCheck.maxPositions}).`);
    STATE.isScanning = false;
    return;
  }

  // ═══ BEST-OF-CYCLE: Solo la señal #1 ══════════════════════════
  if (candidates.length === 0) {
    console.log(`[SCAN #${STATE.scanCount}] Sin señales de calidad este ciclo.`);
    STATE.isScanning = false;
    return;
  }

  // Ordenar por score (mayor primero)
  candidates.sort((a, b) => b.score - a.score);

  // Enviar solo la mejor señal (o las que superen 85 si BEST_OF_CYCLE está activo)
  const toSend = BEST_OF_CYCLE ? [candidates[0]] : candidates.filter(c => c.score >= 85);

  for (const cand of toSend) {
    const { sym, direction, score, quality, reasons, multiTF, indicators, entryTF, candles, agentSizing, newsContext } = cand;

    // Construir señal compatible con el sistema existente
    const sig = {
      signal: direction,
      dir: direction === 'LONG' ? 'up' : 'down',
      score: score / 100 * 14,
      quality,
      reasons,
      macro: multiTF.macroDirection,
      pullback: multiTF.pullbackSetup?.zone,
      atr: indicators?.atrPct || 0,
      mlConfidence: null,
      regime: null,
      agentSizing: agentSizing || { multiplier: 1.0, label: 'NORMAL' },
      newsScore: newsContext?.score || 0,
      newsLevel: newsContext?.level || 'none',
    };

    // Ajustar SL/TP si hay noticia
    if (newsContext && newsContext.score >= 25) {
      const newsAdj = newsSLTPAdjustment(newsContext.score, indicators?.atrPct || 0, direction);
      if (newsAdj) {
        sig.newsSLAdjustment = newsAdj;
        reasons.push(`news_${newsAdj.reason.toLowerCase()}`);
      }
    }

    // Track
    trackSignal(sym, entryTF, direction, sig.score, candles);

    // ═══ TRADE JOURNAL: Registrar trade ═════════════════════════
    const journalEntry = logTrade({
      sym,
      tf: entryTF,
      direction,
      entryPrice: STATE.prices[sym] || 0,
      entryTime: new Date().toISOString(),
      reasons: reasons.slice(0, 5),
      score,
      quality,
      newsScore: newsContext?.score || 0,
      agentConfidence: cand.agentConfidence || 0,
      regime: regime?.regime || 'unknown',
      stopLoss: sig.sl,
      takeProfit: sig.t1,
      positionSize: agentSizing?.multiplier || 1,
      riskReward: sig.rr,
    });

    // ═══ PORTFOLIO: Registrar posición ══════════════════════════
    registerPosition(sym, direction, agentSizing?.multiplier || 1, STATE.prices[sym] || 0);

    // Cooldown
    const cdKey = `${sym}-${direction}`;
    alertCooldown[cdKey] = Date.now();
    lastDirSent[sym] = { dir: direction, time: Date.now() };
    activeThisCycle.add(sym);

    // Enviar a Telegram
    try {
      const msg = buildAlertMessage(sym, entryTF, sig);
      await sendTelegram(msg);
      console.log(`   ✅ [ENVIADO] ${sym} ${entryTF} ${direction} — Score: ${score}/100 (${quality})`);
    } catch (e) {
      console.error(`   ❌ Error enviando ${sym}:`, e.message);
    }

    // Guardar señal activa
    STATE.signals[sym] = {
      ...sig,
      sym,
      tf: entryTF,
      time: new Date().toISOString(),
    };
  }

  if (BEST_OF_CYCLE && candidates.length > 1) {
    console.log(`   [BEST] ${candidates.length} candidatos, enviada solo la #1 (${candidates[0].score}/100)`);
  }

  // Limpiar señales vencidas
  const before = Object.keys(STATE.signals).length;
  for (const key of Object.keys(STATE.signals))
    if (!activeThisCycle.has(key)) delete STATE.signals[key];
  const removed = before - Object.keys(STATE.signals).length;
  if (removed > 0) console.log(`   ${removed} señal(es) vencida(s) eliminada(s).`);

  await evaluatePending(fetchCandles).catch(() => {});

  STATE.isScanning = false;
  const structInfo = ` | Struct: ${STATE.structure.elite} elite, ${STATE.structure.strong} strong, ${STATE.structure.filtered} filtradas`;
  const agentInfo = STATE.agent.trained
    ? ` | Agent: ${STATE.agent.traded} traded, ${STATE.agent.skipped} skipped`
    : '';
  const posInfo = getPositionStats();
  const posString = posInfo.openPositions > 0
    ? ` | Pos: ${posInfo.openPositions} abiertas, PnL: ${posInfo.totalPnl}%`
    : '';
  console.log(`[SCAN #${STATE.scanCount}] OK. Senales: ${Object.keys(STATE.signals).length}${structInfo}${agentInfo}${posString}`);

  // Guardar Q-table cada 10 ciclos
  if (STATE.scanCount % 10 === 0 && STATE.agent.trained) {
    try {
      const qTablePath = join(DATA_DIR, 'agent-qtable.json');
      writeFileSync(qTablePath, JSON.stringify(exportQTable()), 'utf8');
    } catch {}
  }
}

// ── INICIO ───────────────────────────────────────────────────────
export async function startScanner(config) {
  console.log('================================================');
  console.log('  Motor Autonomo 24/7  v8.0');
  console.log('  ML + Regime + Risk + Optimizer + Monte Carlo');
  console.log('  Tracker de resultados ACTIVO');
  console.log('  Horario Mexico activado');
  console.log('================================================');
  STATE.daemonActive = true;

  // Cargar parametros optimizados guardados
  loadOptimizedParams();

  // Entrenar ML al iniciar
  try {
    await trainMLClassifier(config);
  } catch (e) {
    console.error('[ML] Error entrenando:', e.message);
  }

  // Auto-optimizar si no hay parametros guardados
  if (Object.keys(STATE.optimizedParams).length === 0) {
    try {
      await autoOptimize(config);
    } catch (e) {
      console.error('[OPT] Error auto-optimizando:', e.message);
    }
  }

  runCycle(config);
  setInterval(() => runCycle(config), 15 * 60 * 1000); // Cada 15 minutos (calidad > cantidad)

  // Re-optimizar cada 6 horas
  setInterval(() => autoOptimize(config).catch(e => console.error('[OPT] Error:', e.message)), OPT_RETRAIN_MS);
}
