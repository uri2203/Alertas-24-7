// ═══════════════════════════════════════════════════════════════
//  server.js  —  Trading Dashboard PRO v8.0
//  Security: server-side sessions, helmet, rate-limit, CORS
//  + ML + Regime + Risk + Optimizer + Monte Carlo
// ═══════════════════════════════════════════════════════════════
import express           from 'express';
import cors              from 'cors';
import helmet            from 'helmet';
import rateLimit         from 'express-rate-limit';
import path              from 'path';
import crypto            from 'crypto';
import { fileURLToPath } from 'url';
import * as dotenv       from 'dotenv';
dotenv.config();

import { configRouter }    from './routes/config.js';
import { stateRouter }     from './routes/state.js';
import { alertsRouter }    from './routes/alerts.js';
import { trackerRouter }   from './routes/tracker.js';
import { drawingsRouter }  from './routes/drawings.js';
import { backtestRouter }  from './routes/backtest.js';
import { optimizerRouter } from './routes/optimizer.js';
import { startScanner }    from './engine/scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DASHBOARD_PASSWORD) {
  console.error('FATAL: DASHBOARD_PASSWORD must be set in .env');
  process.exit(1);
}

const CONFIG = {
  port:     process.env.PORT     || 3000,
  password: process.env.DASHBOARD_PASSWORD,
  symbols:  (process.env.SCAN_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,DOGEUSDT').split(','),
  tfs:      (process.env.SCAN_TFS     || '1m,5m,15m,1h,4h,1d').split(','),
  telegram: {
    token:  process.env.TELEGRAM_BOT_TOKEN  || '',
    chatId: process.env.TELEGRAM_CHAT_ID   || '',
  },
};

// ── SERVER-SIDE SESSIONS ──────────────────────────────────────
const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000;

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { created: Date.now() });
  return token;
}

function validateSession(token) {
  if (!token) return false;
  const sess = sessions.get(token);
  if (!sess) return false;
  if (Date.now() - sess.created > SESSION_TTL) { sessions.delete(token); return false; }
  sess.created = Date.now();
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of sessions)
    if (now - sess.created > SESSION_TTL) sessions.delete(token);
}, 60 * 60 * 1000);

function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'] || req.query.token;
  if (!validateSession(token)) return res.status(401).json({ ok: false, error: 'No autorizado' });
  next();
}

// ── APP ───────────────────────────────────────────────────────
const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:10000').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(null, false);
  },
  credentials: true,
}));

app.use(rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas peticiones' } }));

const authLimiter = rateLimit({ windowMs: 15 * 60000, max: 10,
  message: { ok: false, error: 'Demasiados intentos de login' } });

const tgLimiter = rateLimit({ windowMs: 60000, max: 15,
  message: { ok: false, error: 'Límite de Telegram alcanzado' } });

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── PUBLIC ROUTES ─────────────────────────────────────────────
app.get('/ping', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.post('/api/login', authLimiter, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ ok: false, error: 'Contraseña requerida' });

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const expected = crypto.createHash('sha256').update(CONFIG.password).digest('hex');

  if (hash !== expected) {
    console.warn('[AUTH] Login fallido desde', req.ip);
    return res.status(403).json({ ok: false, error: 'Contraseña incorrecta' });
  }

  const token = createSession();
  console.log('[AUTH] Login exitoso');
  res.json({ ok: true, token });
});

app.post('/api/logout', (req, res) => {
  sessions.delete(req.headers['x-session-token']);
  res.json({ ok: true });
});

// ── PROTECTED ROUTES ──────────────────────────────────────────
app.use('/api/config',    requireAuth, configRouter(CONFIG));
app.use('/api/state',     requireAuth, stateRouter());
app.use('/api/telegram',  requireAuth, tgLimiter, alertsRouter(CONFIG));
app.use('/api/tracker',   requireAuth, trackerRouter());
app.use('/api/drawings',  requireAuth, drawingsRouter());
app.use('/api/backtest',  requireAuth, backtestRouter());
app.use('/api/optimizer', requireAuth, optimizerRouter());

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── SHUTDOWN ──────────────────────────────────────────────────
process.on('SIGTERM', () => { console.log('\n[SHUTDOWN] SIGTERM'); process.exit(0); });
process.on('SIGINT',  () => { console.log('\n[SHUTDOWN] SIGINT');  process.exit(0); });
process.on('unhandledRejection', (r) => console.error('[FATAL] Unhandled Rejection:', r?.stack || r));
process.on('uncaughtException',  (e) => console.error('[FATAL] Uncaught Exception:', e?.stack || e));

// ── START ─────────────────────────────────────────────────────
app.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════╗
║  Trading Dashboard PRO v8.0                  ║
║  Modo   : Scanner Autonomo 24/7 ACTIVO       ║
║  ML     : Classifier + Regime + Risk         ║
║  Puerto : ${CONFIG.port}                            ║
║  Auth   : Server-side sessions               ║
║  Sec    : Helmet + Rate-Limit + CORS         ║
╚══════════════════════════════════════════════╝`);
  startScanner(CONFIG);
});
