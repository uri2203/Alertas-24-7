// ═══════════════════════════════════════════════════════════════
//  engine/scanner.js
//  Motor de Escaneo Autónomo (Servidor 24/7)
// ═══════════════════════════════════════════════════════════════
import { scoreSignal, TF_CONFIG } from './signals.js';
import { sendTelegram, buildAlertMessage } from './telegram.js';

export const STATE = {
  signals:       {},
  prices:        {},
  lastScan:      null,
  daemonActive:  false, // Verdadero siempre que el servidor esté vivo
  isScanning:    false, // Verdadero solo cuando hace peticiones a Binance
  scanCount:     0,
  errors:        [],
};

const alertCooldown = {};

// Bypass HTTP 451 usando clústeres tolerantes a Cloud IP
async function fetchCandles(symbol, interval, limit = 500) {
  const endpoints = [
    'https://data-api.binance.vision/api/v3/klines',
    'https://api1.binance.com/api/v3/klines',
    'https://api2.binance.com/api/v3/klines',
    'https://api3.binance.com/api/v3/klines'
  ];

  let lastError;
  for (const base of endpoints) {
    try {
      const url = `${base}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Server Daemon)' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.map(k => ({
        time: +k[0] / 1000,
        open: +k[1], high: +k[2], low: +k[3], close: +k[4], vol: +k[5],
      }));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function runCycle(config) {
  if (STATE.isScanning) return;
  STATE.isScanning = true;
  STATE.scanCount++;
  STATE.lastScan = new Date().toISOString();

  console.log(`\n[SCAN #${STATE.scanCount}] Iniciando ciclo autónomo en servidor...`);

  for (const sym of config.symbols) {
    for (const tf of config.tfs) {
      try {
        const candles = await fetchCandles(sym, tf);
        const sig = scoreSignal(candles, tf, TF_CONFIG);

        if (candles && candles.length) {
            STATE.prices[sym] = candles[candles.length - 1].close;
        }

        if (!sig || sig.signal === 'WAIT') continue;
        if (sig.score < 4) continue;

        const key = `${sym}-${tf}`;
        STATE.signals[key] = { sym, tf, ...sig };

        const now = Date.now();
        const cooldownMs = 10 * 60 * 1000;

        if (!alertCooldown[key] || now - alertCooldown[key] > cooldownMs) {
          alertCooldown[key] = now;
          const text = buildAlertMessage(sym, tf, sig);
          if (config.telegram.token && config.telegram.chatId) {
             const result = await sendTelegram(config.telegram.token, config.telegram.chatId, text);
             if (result.ok) {
               console.log(`   ✅ [ALERTA ENVIADA] ${sig.signal} ${sym} ${tf} (Score: ${sig.score}/5)`);
             } else {
               console.log(`   ❌ [ERR TELEGRAM] ${JSON.stringify(result)}`);
             }
          }
        }
      } catch (e) {
        console.error(`   [ERR] Scanner ${sym}/${tf}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 600)); // Retardo anti-bloqueo
    }
  }

  STATE.isScanning = false;
  console.log(`[SCAN #${STATE.scanCount}] Ciclo completado. Motor en espera.`);
}

export function startScanner(config) {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Motor Autónomo 24/7 INICIADO            ║');
  console.log('╚══════════════════════════════════════════╝');
  
  STATE.daemonActive = true;
  
  // Ejecución inmediata y bucle cada 3 minutos
  runCycle(config);
  setInterval(() => runCycle(config), 3 * 60 * 1000);
}
