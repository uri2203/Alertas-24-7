// ═══════════════════════════════════════════════════════════════
//  routes/backtest.js  —  Trading Dashboard PRO v8.0
//  API para ejecutar backtests con ML + Risk + Monte Carlo
//  POST /api/backtest          → ejecuta backtest completo
//  GET  /api/backtest          → lista resultados guardados
//  GET  /api/backtest/:sym/:tf → obtiene resultado específico
//  POST /api/backtest/monte    → ejecuta Monte Carlo sobre trades existentes
//  POST /api/backtest/risk     → calcula métricas de riesgo
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runBacktest, calcMetrics } from '../engine/backtester.js';
import { monteCarloSimulation, monteCarloReport, robustnessScore } from '../engine/monte.js';
import { generateRiskReport } from '../engine/risk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let running = false;

export function backtestRouter() {
  const router = Router();

  // ── GET: listar resultados guardados ─────────────────────────
  router.get('/', (req, res) => {
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('backtest-') && f.endsWith('.json'));
      const results = files.map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
        const parts = f.replace('backtest-', '').replace('.json', '').split('-');
        return {
          symbol: parts[0] || '',
          tf: parts[1] || '',
          ...data,
        };
      });
      res.json({ ok: true, results, running });
    } catch (e) {
      res.json({ ok: true, results: [], running });
    }
  });

  // ── GET: resultado específico ────────────────────────────────
  router.get('/:sym/:tf', (req, res) => {
    try {
      const { sym, tf } = req.params;
      const fp = path.join(DATA_DIR, `backtest-${sym}-${tf}.json`);
      if (!fs.existsSync(fp)) return res.json({ ok: false, error: 'No encontrado' });
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      res.json({ ok: true, ...data });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // ── POST: ejecutar backtest completo v8.0 ────────────────────
  router.post('/', async (req, res) => {
    if (running) return res.json({ ok: false, error: 'Backtest ya en ejecución' });

    const { symbol = 'BTCUSDT', tf = '1h', lookback = 500 } = req.body || {};
    running = true;

    try {
      console.log(`[BACKTEST v8.0] Iniciando ${symbol} ${tf} ${lookback} velas...`);
      const trades = await runBacktest(symbol, tf, lookback);
      const metrics = calcMetrics(trades);

      // Monte Carlo
      console.log(`[BACKTEST v8.0] Ejecutando Monte Carlo...`);
      const mc = monteCarloSimulation(trades, { iterations: 10000, capital: 10000 });
      const robustness = robustnessScore(mc);

      // Risk Report
      const riskReport = generateRiskReport(trades, 10000);

      const fullReport = {
        metrics,
        monteCarlo: mc,
        robustness,
        riskReport,
        timestamp: new Date().toISOString(),
      };

      // Guardar resultado
      const outPath = path.join(DATA_DIR, `backtest-${symbol}-${tf}.json`);
      fs.writeFileSync(outPath, JSON.stringify(fullReport, null, 2), 'utf8');

      console.log(`[BACKTEST v8.0] Completado: ${metrics.total} trades, WR=${metrics.winRate}%, Robustez=${robustness}/100`);
      running = false;
      res.json({ ok: true, ...fullReport });
    } catch (e) {
      running = false;
      console.error('[BACKTEST v8.0] Error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── POST: Monte Carlo sobre trades existentes ────────────────
  router.post('/monte', (req, res) => {
    try {
      const { symbol = 'BTCUSDT', tf = '1h', iterations = 10000, capital = 10000 } = req.body || {};

      // Cargar trades del backtest guardado
      const fp = path.join(DATA_DIR, `backtest-${symbol}-${tf}.json`);
      if (!fs.existsSync(fp)) return res.json({ ok: false, error: 'No hay backtest para este par. Ejecuta primero.' });

      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const trades = data.metrics?.trades || data.trades || [];
      if (!trades.length) return res.json({ ok: false, error: 'No hay trades para simular' });

      const mc = monteCarloSimulation(trades, { iterations, capital });
      const robustness = robustnessScore(mc);
      const report = monteCarloReport(mc);

      res.json({ ok: true, monteCarlo: mc, robustness, report });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── POST: Risk Report sobre trades existentes ────────────────
  router.post('/risk', (req, res) => {
    try {
      const { symbol = 'BTCUSDT', tf = '1h', capital = 10000 } = req.body || {};

      const fp = path.join(DATA_DIR, `backtest-${symbol}-${tf}.json`);
      if (!fs.existsSync(fp)) return res.json({ ok: false, error: 'No hay backtest para este par' });

      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const trades = data.metrics?.trades || data.trades || [];
      if (!trades.length) return res.json({ ok: false, error: 'No hay trades para analizar' });

      const riskReport = generateRiskReport(trades, capital);
      res.json({ ok: true, riskReport });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
