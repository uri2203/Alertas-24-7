// ═══════════════════════════════════════════════════════════════
//  routes/backtest.js  —  Trading Dashboard PRO v7
//  API para ejecutar backtests desde el dashboard
//  POST /api/backtest          → ejecuta backtest (symbol, tf, lookback)
//  GET  /api/backtest          → lista resultados guardados
//  GET  /api/backtest/:sym/:tf → obtiene resultado específico
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runBacktest, calcMetrics } from '../engine/backtester.js';

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

  // ── POST: ejecutar backtest ──────────────────────────────────
  router.post('/', async (req, res) => {
    if (running) return res.json({ ok: false, error: 'Backtest ya en ejecución' });

    const { symbol = 'BTCUSDT', tf = '1h', lookback = 500 } = req.body || {};
    running = true;

    try {
      console.log(`[BACKTEST] Iniciando ${symbol} ${tf} ${lookback} velas...`);
      const trades = await runBacktest(symbol, tf, lookback);
      const metrics = calcMetrics(trades);

      // Guardar resultado
      const outPath = path.join(DATA_DIR, `backtest-${symbol}-${tf}.json`);
      fs.writeFileSync(outPath, JSON.stringify(metrics, null, 2), 'utf8');

      console.log(`[BACKTEST] Completado: ${metrics.total} trades, WR=${metrics.winRate}%`);
      running = false;
      res.json({ ok: true, ...metrics });
    } catch (e) {
      running = false;
      console.error('[BACKTEST] Error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
