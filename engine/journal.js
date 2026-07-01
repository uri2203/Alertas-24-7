// ═══════════════════════════════════════════════════════════════
//  engine/journal.js  —  Trade Journal v8.0
//  Registro detallado de CADA trade para análisis post-mortem
//  "Los profesionales llevan diario de trading, los amateurs adivinan"
// ═══════════════════════════════════════════════════════════════

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
const JOURNAL_FILE = join(DATA_DIR, 'trade-journal.json');

// Asegurar que existe el directorio
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ── ESTRUCTURA DE UN TRADE JOURNAL ENTRY ───────────────────────
function createJournalEntry(trade) {
  return {
    id: `T${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    timestamp: new Date().toISOString(),

    // Datos de entrada
    sym: trade.sym,
    tf: trade.tf,
    direction: trade.direction,
    entryPrice: trade.entryPrice,
    entryTime: trade.entryTime,

    // Razones de entrada
    reasons: trade.reasons || [],
    score: trade.score || 0,
    quality: trade.quality || 'unknown',
    newsScore: trade.newsScore || 0,
    agentConfidence: trade.agentConfidence || 0,
    regime: trade.regime || 'unknown',

    // Gestión de riesgo
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    positionSize: trade.positionSize,
    riskReward: trade.riskReward,

    // Resultado (se llena al cerrar)
    exitPrice: null,
    exitTime: null,
    exitReason: null,
    pnl: null,
    pnlPct: null,
    result: null, // 'WIN', 'LOSS', 'BREAKEVEN'

    // Análisis post-trade
    lessons: [],
    marketCondition: null,
    whatWorked: [],
    whatFailed: [],
    grade: null, // A, B, C, D, F
  };
}

// ── GUARDAR TRADE EN JOURNAL ───────────────────────────────────
export function logTrade(tradeData) {
  const journal = loadJournal();
  const entry = createJournalEntry(tradeData);

  journal.trades.push(entry);
  journal.lastUpdated = new Date().toISOString();

  saveJournal(journal);
  return entry;
}

// ── ACTUALIZAR TRADE AL CERRAR ─────────────────────────────────
export function closeTrade(tradeId, closeData) {
  const journal = loadJournal();
  const trade = journal.trades.find(t => t.id === tradeId);

  if (!trade) return null;

  trade.exitPrice = closeData.exitPrice;
  trade.exitTime = closeData.exitTime || new Date().toISOString();
  trade.exitReason = closeData.exitReason || 'manual';

  // Calcular P&L
  if (trade.direction === 'LONG') {
    trade.pnl = (trade.exitPrice - trade.entryPrice) / trade.entryPrice * (trade.positionSize || 1);
  } else {
    trade.pnl = (trade.entryPrice - trade.exitPrice) / trade.entryPrice * (trade.positionSize || 1);
  }
  trade.pnlPct = trade.pnl * 100;

  // Determinar resultado
  if (trade.pnl > 0.001) trade.result = 'WIN';
  else if (trade.pnl < -0.001) trade.result = 'LOSS';
  else trade.result = 'BREAKEVEN';

  // Auto-grade basado en performance
  trade.grade = autoGrade(trade);

  // Análisis automático
  analyzeTrade(trade);

  // Actualizar estadísticas del journal
  journal.stats = calculateJournalStats(journal.trades);
  journal.lastUpdated = new Date().toISOString();

  saveJournal(journal);
  return trade;
}

// ── AUTO-GRADING ───────────────────────────────────────────────
function autoGrade(trade) {
  const pnl = trade.pnlPct || 0;
  const rr = trade.riskReward || 0;

  if (pnl >= 5 && rr >= 3) return 'A';   // Excelente
  if (pnl >= 3 && rr >= 2) return 'B';   // Bueno
  if (pnl >= 1) return 'C';              // Aceptable
  if (pnl >= -1) return 'D';             // Marginal
  return 'F';                             // Malo
}

// ── ANÁLISIS AUTOMÁTICO DEL TRADE ──────────────────────────────
function analyzeTrade(trade) {
  // Qué funcionó
  if (trade.score >= 90) trade.whatWorked.push('alta_calidad_score');
  if (trade.newsScore >= 50) trade.whatWorked.push('noticia_detectada');
  if (trade.agentConfidence >= 0.85) trade.whatWorked.push('alta_confianza_agente');

  // Qué falló
  if (trade.result === 'LOSS') {
    if (trade.score < 85) trade.whatFailed.push('score_bajo');
    if (trade.newsScore >= 75) trade.whatFailed.push('noticia_extrema_riesgosa');
    if (trade.agentConfidence < 0.70) trade.whatFailed.push('baja_confianza');
  }

  // Condiciones del mercado
  trade.marketCondition = trade.regime || 'unknown';
}

// ── CARGAR JOURNAL ─────────────────────────────────────────────
function loadJournal() {
  try {
    if (existsSync(JOURNAL_FILE)) {
      return JSON.parse(readFileSync(JOURNAL_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }

  return {
    trades: [],
    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgPnL: 0,
      totalPnL: 0,
      gradeDistribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
    },
    lastUpdated: new Date().toISOString(),
  };
}

// ── GUARDAR JOURNAL ────────────────────────────────────────────
function saveJournal(journal) {
  writeFileSync(JOURNAL_FILE, JSON.stringify(journal, null, 2), 'utf8');
}

// ── CALCULAR ESTADÍSTICAS ──────────────────────────────────────
function calculateJournalStats(trades) {
  if (trades.length === 0) return {
    totalTrades: 0, wins: 0, losses: 0, winRate: 0,
    avgPnL: 0, totalPnL: 0, gradeDistribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
  };

  const wins = trades.filter(t => t.result === 'WIN').length;
  const losses = trades.filter(t => t.result === 'LOSS').length;
  const totalPnL = trades.reduce((sum, t) => sum + (t.pnlPct || 0), 0);
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };

  trades.forEach(t => {
    if (t.grade && grades[t.grade] !== undefined) grades[t.grade]++;
  });

  return {
    totalTrades: trades.length,
    wins,
    losses,
    winRate: +((wins / trades.length) * 100).toFixed(1),
    avgPnL: +(totalPnL / trades.length).toFixed(2),
    totalPnL: +totalPnL.toFixed(2),
    gradeDistribution: grades,
  };
}

// ── OBTENER ESTADÍSTICAS ───────────────────────────────────────
export function getJournalStats() {
  const journal = loadJournal();
  return journal.stats;
}

// ── OBTENER ÚLTIMOS TRADES ─────────────────────────────────────
export function getRecentTrades(limit = 20) {
  const journal = loadJournal();
  return journal.trades.slice(-limit).reverse();
}

// ── OBTENER ANÁLISIS DE ERRORES ────────────────────────────────
export function getErrorAnalysis() {
  const journal = loadJournal();
  const losses = journal.trades.filter(t => t.result === 'LOSS');

  const errorPatterns = {};
  losses.forEach(t => {
    t.whatFailed.forEach(err => {
      errorPatterns[err] = (errorPatterns[err] || 0) + 1;
    });
  });

  return {
    totalLosses: losses.length,
    errorPatterns,
    mostCommonError: Object.entries(errorPatterns).sort((a, b) => b[1] - a[1])[0],
  };
}

// ── OBTENER LECCIONES FRECUENTES ───────────────────────────────
export function getLessonsLearned() {
  const journal = loadJournal();
  const wins = journal.trades.filter(t => t.result === 'WIN');

  const lessons = {};
  wins.forEach(t => {
    t.whatWorked.forEach(lesson => {
      lessons[lesson] = (lessons[lesson] || 0) + 1;
    });
  });

  return {
    totalWins: wins.length,
    lessons,
    bestPatterns: Object.entries(lessons).sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}

// ── EXPORTAR JOURNAL ───────────────────────────────────────────
export function exportJournal() {
  return loadJournal();
}
