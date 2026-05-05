// ═══════════════════════════════════════════════════════════════
//  server.js  —  Trading Dashboard PRO v6  (Scanner Autónomo)
//  El servidor sirve archivos estáticos, proxyea Telegram
//  y corre el scanner 24/7 en background.
// ═══════════════════════════════════════════════════════════════
import express           from 'express';
import cors              from 'cors';
import path              from 'path';
import { fileURLToPath } from 'url';
import * as dotenv       from 'dotenv';
dotenv.config();

import { configRouter }  from './routes/config.js';
import { stateRouter }   from './routes/state.js';
import { alertsRouter }  from './routes/alerts.js';
import { startScanner }  from './engine/scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── APP CONFIG ────────────────────────────────────────────────
const CONFIG = {
  port:     process.env.PORT     || 3000,
  password: process.env.DASHBOARD_PASSWORD || 'trading2025',
  symbols:  (process.env.SCAN_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,DOGEUSDT').split(','),
  tfs:      (process.env.SCAN_TFS     || '1m,5m,15m,1h,4h,1d').split(','),
  telegram: {
    token:  process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID   || '',
  },
};

// ── EXPRESS SETUP ─────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── ROUTES ────────────────────────────────────────────────────
app.get('/ping',         (_, res) => res.json({ ok: true, time: new Date().toISOString(), mode: 'scanner-activo' }));
app.use('/api/config',   configRouter(CONFIG));
app.use('/api/state',    stateRouter());
app.use('/api/telegram', alertsRouter(CONFIG));

// Catch-all → serve frontend
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── START ─────────────────────────────────────────────────────
app.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║  Trading Dashboard PRO v6                ║
║  Modo   : Scanner Autónomo 24/7 ACTIVO   ║
║  Puerto : ${CONFIG.port}                          ║
╚══════════════════════════════════════════╝
  `);

  // Arranca el scanner después de que el servidor esté listo
  startScanner(CONFIG);
});
