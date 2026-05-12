// ═══════════════════════════════════════════════════════════════
//  engine/tracker.js  —  Trading Dashboard PRO v7
//  Registra cada señal enviada y evalúa resultados a 1h, 4h, 24h
//  Almacenamiento: JSONbin.io (persistente, gratuito)
// ═══════════════════════════════════════════════════════════════

const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY || '';
const JSONBIN_BASE    = 'https://api.jsonbin.io/v3';

// BIN_ID se toma de la variable de entorno — si no existe se crea uno nuevo
let BIN_ID = process.env.JSONBIN_BIN_ID || '';

// ── INICIALIZAR BIN ───────────────────────────────────────────────
async function initBin() {
  if (BIN_ID) return; // ya tenemos bin configurado
  if (!JSONBIN_API_KEY) {
    console.error('[TRACKER] ❌ JSONBIN_API_KEY no configurada en Render.');
    return;
  }

  try {
    const res  = await fetch(`${JSONBIN_BASE}/b`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-Master-Key':  JSONBIN_API_KEY,
        'X-Bin-Name':    'trading-tracker',
        'X-Bin-Private': 'true',
      },
      body: JSON.stringify({ signals: [] }),
    });

    const text = await res.text();
    console.log('[TRACKER] Respuesta JSONbin al crear bin:', text);

    const data = JSON.parse(text);
    const id   = data?.metadata?.id || data?.record || '';

    if (id) {
      BIN_ID = id;
      console.log(`[TRACKER] ✅ Bin creado correctamente: ${BIN_ID}`);
      console.log(`[TRACKER] ⚠️  AGREGA EN RENDER → Environment: JSONBIN_BIN_ID=${BIN_ID}`);
    } else {
      console.error('[TRACKER] ❌ No se pudo obtener el ID del bin. Respuesta:', text);
    }
  } catch (e) {
    console.error(`[TRACKER] Error creando bin: ${e.message}`);
  }
}

// ── LEER SEÑALES ─────────────────────────────────────────────────
async function readSignals() {
  if (!BIN_ID || !JSONBIN_API_KEY) return [];
  try {
    const res  = await fetch(`${JSONBIN_BASE}/b/${BIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY },
    });
    const data = await res.json();
    return data.record?.signals || [];
  } catch (e) {
    console.error(`[TRACKER] Error leyendo: ${e.message}`);
    return [];
  }
}

// ── ESCRIBIR SEÑALES ──────────────────────────────────────────────
async function writeSignals(signals) {
  if (!BIN_ID || !JSONBIN_API_KEY) return;
  try {
    await fetch(`${JSONBIN_BASE}/b/${BIN_ID}`, {
      method:  'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY,
      },
      body: JSON.stringify({ signals }),
    });
  } catch (e) {
    console.error(`[TRACKER] Error escribiendo: ${e.message}`);
  }
}

// ── REGISTRAR SEÑAL ENVIADA ───────────────────────────────────────
export async function trackSignal(sym, tf, sig, isDivergence = false) {
  if (!JSONBIN_API_KEY) return;
  await initBin();
  if (!BIN_ID) return;

  const signals = await readSignals();
  const record  = {
    id:           `${sym}-${tf}-${Date.now()}`,
    sym, tf,
    signal:       sig.signal,
    dir:          sig.dir,
    score:        sig.score,
    max:          sig.max,
    entryPrice:   sig.price,
    entry:        sig.entry,
    sl:           sig.sl,
    t1:           sig.t1,
    t2:           sig.t2,
    isDivergence,
    rules:        sig.rules,
    sentAt:       new Date().toISOString(),
    result1h:     null,
    result4h:     null,
    result24h:    null,
    price1h:      null,
    price4h:      null,
    price24h:     null,
    evaluated:    false,
  };

  signals.unshift(record);
  if (signals.length > 200) signals.splice(200);

  await writeSignals(signals);
  console.log(`[TRACKER] ✍️  Señal registrada: ${sig.signal} ${sym} ${tf} @ ${sig.price}`);
}

// ── EVALUAR RESULTADOS PENDIENTES ─────────────────────────────────
export async function evaluatePending(fetchCandlesFn) {
  if (!JSONBIN_API_KEY || !BIN_ID) return;

  const signals  = await readSignals();
  if (!signals.length) return;

  let   modified = false;
  const now      = Date.now();

  for (const rec of signals) {
    if (rec.evaluated) continue;

    const sentMs  = new Date(rec.sentAt).getTime();
    const elapsed = now - sentMs;

    let currentPrice = null;
    try {
      const candles = await fetchCandlesFn(rec.sym, '1m', 2);
      currentPrice  = candles?.[candles.length - 1]?.close || null;
    } catch (_) {}

    if (!currentPrice) continue;

    const isLong     = rec.signal === 'LONG';
    const calcResult = (refPrice, curPrice) => {
      if (!refPrice || !curPrice) return null;
      return (isLong ? curPrice > refPrice : curPrice < refPrice) ? 'WIN' : 'LOSS';
    };

    if (!rec.result1h && elapsed >= 60 * 60 * 1000) {
      rec.price1h  = currentPrice;
      rec.result1h = calcResult(rec.entryPrice, currentPrice);
      modified     = true;
    }
    if (!rec.result4h && elapsed >= 4 * 60 * 60 * 1000) {
      rec.price4h  = currentPrice;
      rec.result4h = calcResult(rec.entryPrice, currentPrice);
      modified     = true;
    }
    if (!rec.result24h && elapsed >= 24 * 60 * 60 * 1000) {
      rec.price24h  = currentPrice;
      rec.result24h = calcResult(rec.entryPrice, currentPrice);
      rec.evaluated = true;
      modified      = true;
    }
  }

  if (modified) {
    await writeSignals(signals);
    console.log(`[TRACKER] 📊 Resultados actualizados.`);
  }
}

// ── ESTADÍSTICAS ──────────────────────────────────────────────────
export async function getStats() {
  if (!BIN_ID) await initBin();
  const signals = await readSignals();
  if (!signals.length) return { total: 0, signals: [] };

  const calc = (arr, field) => {
    const valid = arr.filter(s => s[field] !== null);
    if (!valid.length) return null;
    const wins = valid.filter(s => s[field] === 'WIN').length;
    return { wins, total: valid.length, pct: Math.round(wins / valid.length * 100) };
  };

  const byPair = {};
  const byTF   = {};
  const byDir  = { LONG: { wins1h: 0, total1h: 0 }, SHORT: { wins1h: 0, total1h: 0 } };

  for (const s of signals) {
    if (!byPair[s.sym]) byPair[s.sym] = [];
    byPair[s.sym].push(s);
    if (!byTF[s.tf]) byTF[s.tf] = [];
    byTF[s.tf].push(s);
    if (s.result1h && byDir[s.signal]) {
      byDir[s.signal].total1h++;
      if (s.result1h === 'WIN') byDir[s.signal].wins1h++;
    }
  }

  const condFails = {};
  for (const s of signals) {
    if (!s.rules) continue;
    for (const [k, v] of Object.entries(s.rules))
      if (typeof v === 'boolean' && !v)
        condFails[k] = (condFails[k] || 0) + 1;
  }
  const topFail = Object.entries(condFails).sort((a, b) => b[1] - a[1])[0];

  return {
    total:   signals.length,
    pending: signals.filter(s => !s.evaluated).length,
    overall: {
      h1:  calc(signals, 'result1h'),
      h4:  calc(signals, 'result4h'),
      h24: calc(signals, 'result24h'),
    },
    byPair: Object.entries(byPair).map(([sym, arr]) => ({
      sym, total: arr.length, h1: calc(arr, 'result1h'),
    })).sort((a, b) => b.total - a.total).slice(0, 10),
    byTF: Object.entries(byTF).map(([tf, arr]) => ({
      tf, total: arr.length, h1: calc(arr, 'result1h'), h4: calc(arr, 'result4h'),
    })).sort((a, b) => b.total - a.total),
    byDir: {
      LONG:  { total: byDir.LONG.total1h,  pct1h: byDir.LONG.total1h  ? Math.round(byDir.LONG.wins1h  / byDir.LONG.total1h  * 100) : null },
      SHORT: { total: byDir.SHORT.total1h, pct1h: byDir.SHORT.total1h ? Math.round(byDir.SHORT.wins1h / byDir.SHORT.total1h * 100) : null },
    },
    topFailingCondition: topFail ? { name: topFail[0], count: topFail[1] } : null,
    signals: signals.slice(0, 50),
  };
}
