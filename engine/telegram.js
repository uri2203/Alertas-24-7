// ═══════════════════════════════════════════════════════════════
//  engine/telegram.js  —  Trading Dashboard PRO v7
// ═══════════════════════════════════════════════════════════════

const fp = v => {
  if (!v || isNaN(v)) return '—';
  return v > 100
    ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : v.toFixed(4);
};

export function buildAlertMessage(sym, tf, sig, isDivergence = false) {
  const emoji = sig.signal === 'LONG' ? '🟢' : '🔴';
  const time  = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  const r     = sig.rules || {};

  // Encabezado especial si es señal de divergencia
  const header = isDivergence
    ? `📐 <b>DIVERGENCIA RSI — ${sig.signal} ${sym} ${tf.toUpperCase()}</b>`
    : `${emoji} <b>SEÑAL ${sig.signal} — ${sym} ${tf.toUpperCase()}</b>`;

  const divLine = sig.divergence
    ? `\n📐 <b>Divergencia:</b> ${sig.divergence === 'bullish' ? '🟢 Alcista (precio nuevo mín, RSI no)' : '🔴 Bajista (precio nuevo máx, RSI no)'}`
    : '';

  return `${header}

🕐 <b>Hora MX:</b> ${time}
📊 <b>Confluencia:</b> ${sig.score}/${sig.max} condiciones
${sig.dir === 'up' ? '▲ Dirección: ALCISTA' : '▼ Dirección: BAJISTA'}${divLine}

💰 <b>Niveles de operación:</b>
  • Entrada:  <code>${fp(sig.entry)}</code>
  • Stop:     <code>${fp(sig.sl)}</code>
  • Target 1: <code>${fp(sig.t1)}</code>
  • Target 2: <code>${fp(sig.t2)}</code>
  • VPOC:     <code>${fp(sig.vpoc)}</code>

📋 <b>Condiciones activas:</b>
  ${r.fldDir      ? '✅' : '❌'} Hurst FLD (${r.fldDir || '—'})
  ${r.inFib       ? '✅' : '❌'} Zona Fibonacci 38.2–61.8%
  ${r.pvOk        ? '✅' : '❌'} Confluencia Pivote
  ${r.w1ok        ? '✅' : '❌'} Onda de Elliott detectada
  ${r.rsiVolumeOk ? '✅' : '❌'} RSI alineado + Volumen confirmado
  ${r.tfMayorOk   ? '✅' : '❌'} Timeframe mayor alineado
  ${r.macdOk      ? '✅' : '❌'} MACD confirmando dirección
  ${r.adxOk       ? '✅' : '❌'} ADX > 25 (tendencia real, no lateral)

⚠️ <i>Sistema automático. Valida siempre con tu análisis personal.</i>`;
}

export async function sendTelegram(token, chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
