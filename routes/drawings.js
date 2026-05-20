// ═══════════════════════════════════════════════════════════════
//  routes/drawings.js  —  Trading Dashboard PRO v7
//  Guarda y carga dibujos del usuario en GitHub como base de datos
//  GET  /api/drawings/:symbol/:tf  → carga dibujos
//  POST /api/drawings/:symbol/:tf  → guarda dibujos
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express';

const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_OWNER = process.env.GITHUB_OWNER || '';
const GH_REPO  = process.env.GITHUB_REPO  || '';
const GH_API   = 'https://api.github.com';

function ghHeaders() {
  return {
    'Authorization': `token ${GH_TOKEN}`,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json',
    'User-Agent':    'TradingDashboardPRO/7',
  };
}

async function ghGet(filePath) {
  const url = `${GH_API}/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${r.status}`);
  return r.json();
}

async function ghPut(filePath, content, sha) {
  const url  = `${GH_API}/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}`;
  const body = {
    message: `drawings: ${filePath}`,
    content: Buffer.from(JSON.stringify(content)).toString('base64'),
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method:  'PUT',
    headers: ghHeaders(),
    body:    JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`GitHub PUT ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.content?.sha || null;
}

export function drawingsRouter() {
  const router = Router();

  // ── GET: cargar dibujos ──────────────────────────────────────
  router.get('/:symbol/:tf', async (req, res) => {
    if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
      return res.json({ ok: false, drawings: [], sha: null, error: 'GitHub no configurado en variables de entorno' });
    }
    try {
      const { symbol, tf } = req.params;
      const file = await ghGet(`drawings/${symbol}_${tf}.json`);
      if (!file) return res.json({ ok: true, drawings: [], sha: null });
      const content = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
      res.json({ ok: true, drawings: content.drawings || [], sha: file.sha });
    } catch (e) {
      console.error('[DRAWINGS GET]', e.message);
      res.json({ ok: true, drawings: [], sha: null });
    }
  });

  // ── POST: guardar dibujos ────────────────────────────────────
  router.post('/:symbol/:tf', async (req, res) => {
    if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
      return res.status(500).json({ ok: false, error: 'GitHub no configurado en variables de entorno' });
    }
    try {
      const { symbol, tf } = req.params;
      const { drawings, sha } = req.body;
      const newSha = await ghPut(
        `drawings/${symbol}_${tf}.json`,
        { drawings, updated: new Date().toISOString() },
        sha
      );
      res.json({ ok: true, sha: newSha });
    } catch (e) {
      console.error('[DRAWINGS POST]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
