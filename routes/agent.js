import { Router } from 'express';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { getAgentStats, exportQTable, resetAgent } from '../engine/agent.js';

const router = Router();
const DATA_DIR = join(process.cwd(), 'data');

// GET /api/agent — estadísticas del agente
router.get('/', (req, res) => {
  const stats = getAgentStats();
  const qPath = join(DATA_DIR, 'agent-qtable.json');
  const hasQTable = existsSync(qPath);

  res.json({
    stats,
    hasQTable,
    scannerState: req.app.locals?.scannerState?.agent || null,
  });
});

// POST /api/agent/reset — resetear Q-table
router.post('/reset', (req, res) => {
  resetAgent();
  const qPath = join(DATA_DIR, 'agent-qtable.json');
  if (existsSync(qPath)) writeFileSync(qPath, '{}', 'utf8');
  res.json({ ok: true, message: 'Agente reiniciado' });
});

// POST /api/agent/save — guardar Q-table manualmente
router.post('/save', (req, res) => {
  try {
    const data = exportQTable();
    const qPath = join(DATA_DIR, 'agent-qtable.json');
    writeFileSync(qPath, JSON.stringify(data), 'utf8');
    res.json({ ok: true, states: data.qTable.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
