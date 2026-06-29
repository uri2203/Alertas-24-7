// ═══════════════════════════════════════════════════════════════
//  routes/optimizer.js  —  Trading Dashboard PRO v8.0
//  API para optimizar parametros por crypto/TF
//  POST /api/optimizer/run     → ejecuta optimizacion genetica
//  GET  /api/optimizer         → lista resultados guardados
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { geneticOptimize } from '../engine/optimizer.js';
import { fetchCandles } from '../engine/scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let running = false;

export function optimizerRouter() {
  const router = Router();

  // ── GET: listar optimizaciones guardadas ──────────────────────
  router.get('/', (req, res) => {
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('opt-') && f.endsWith('.json'));
      const results = files.map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
        const parts = f.replace('opt-', '').replace('.json', '').split('-');
        return { symbol: parts[0] || '', tf: parts[1] || '', ...data };
      });
      res.json({ ok: true, results, running });
    } catch (e) {
      res.json({ ok: true, results: [], running });
    }
  });

  // ── POST: ejecutar optimizacion genetica ─────────────────────
  router.post('/run', async (req, res) => {
    if (running) return res.json({ ok: false, error: 'Optimizacion ya en ejecucion' });

    const { symbol = 'BTCUSDT', tf = '1h', popSize = 20, generations = 15 } = req.body || {};
    running = true;

    try {
      console.log(`[OPT] Iniciando optimizacion ${symbol} ${tf} (pop=${popSize}, gen=${generations})...`);
      const candles = await fetchCandles(symbol, tf, 1000);
      console.log(`[OPT] ${candles.length} velas descargadas`);

      const result = geneticOptimize(candles, tf, { popSize, generations, eliteSize: 3 });

      const report = {
        symbol, tf,
        bestGene: result.bestGene,
        bestFitness: +result.bestFitness.toFixed(4),
        history: result.history,
        timestamp: new Date().toISOString(),
      };

      // Guardar resultado
      const outPath = path.join(DATA_DIR, `opt-${symbol}-${tf}.json`);
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

      console.log(`[OPT] Completado: fitness=${report.bestFitness}`);
      running = false;
      res.json({ ok: true, ...report });
    } catch (e) {
      running = false;
      console.error('[OPT] Error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── POST: optimizar todos los pares ──────────────────────────
  router.post('/run-all', async (req, res) => {
    if (running) return res.json({ ok: false, error: 'Ya en ejecucion' });

    const symbols = (req.body?.symbols || 'BTCUSDT,ETHUSDT,SOLUSDT').split(',');
    const tf = req.body?.tf || '1h';
    running = true;

    try {
      const results = {};
      for (const sym of symbols) {
        console.log(`[OPT] Optimizando ${sym} ${tf}...`);
        try {
          const candles = await fetchCandles(sym, tf, 1000);
          if (candles.length < 200) continue;
          const opt = geneticOptimize(candles, tf, { popSize: 15, generations: 10 });
          results[sym] = { bestGene: opt.bestGene, bestFitness: opt.bestFitness };
        } catch (e) {
          console.error(`[OPT] Error ${sym}: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 500));
      }

      const outPath = path.join(DATA_DIR, 'opt-all.json');
      fs.writeFileSync(outPath, JSON.stringify({ results, tf, timestamp: new Date().toISOString() }, null, 2), 'utf8');

      running = false;
      res.json({ ok: true, results });
    } catch (e) {
      running = false;
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
