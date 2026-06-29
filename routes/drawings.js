// ═══════════════════════════════════════════════════════════════
//  routes/drawings.js  —  Trading Dashboard PRO v7
//  Guarda y carga dibujos del usuario en almacenamiento local
//  GET  /api/drawings/:symbol/:tf  → carga dibujos
//  POST /api/drawings/:symbol/:tf  → guarda dibujos
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRAWINGS_DIR = path.join(__dirname, '..', 'data', 'drawings');

if (!fs.existsSync(DRAWINGS_DIR)) fs.mkdirSync(DRAWINGS_DIR, { recursive: true });

function getFilePath(symbol, tf) {
  return path.join(DRAWINGS_DIR, `${symbol}_${tf}.json`);
}

export function drawingsRouter() {
  const router = Router();

  // ── GET: cargar dibujos ──────────────────────────────────────
  router.get('/:symbol/:tf', (req, res) => {
    try {
      const { symbol, tf } = req.params;
      const fp = getFilePath(symbol, tf);
      if (!fs.existsSync(fp)) return res.json({ ok: true, drawings: [], sha: null });
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      res.json({ ok: true, drawings: data.drawings || [], sha: null });
    } catch (e) {
      console.error('[DRAWINGS GET]', e.message);
      res.json({ ok: true, drawings: [], sha: null });
    }
  });

  // ── POST: guardar dibujos ────────────────────────────────────
  router.post('/:symbol/:tf', (req, res) => {
    try {
      const { symbol, tf } = req.params;
      const { drawings } = req.body;
      const fp = getFilePath(symbol, tf);
      fs.writeFileSync(fp, JSON.stringify({
        drawings,
        updated: new Date().toISOString(),
      }, null, 2), 'utf8');
      res.json({ ok: true, sha: null });
    } catch (e) {
      console.error('[DRAWINGS POST]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
