// ═══════════════════════════════════════════════════════════════
//  engine/telegram.js  —  Trading Dashboard PRO v8.0
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

  // Encabezado con calidad
  const qualityEmoji = sig.quality === 'elite' ? '🏆' : '💪';
  const header = `${emoji} <b>SEÑAL ${sig.signal} — ${sym} ${tf.toUpperCase()}</b>
${qualityEmoji} <b>Calidad:</b> ${sig.quality?.toUpperCase()} (${sig.score}/100)`;

  // Estructura
  const macroLine = sig.macro
    ? `\n📈 <b>Macro:</b> ${sig.macro === 'bullish' ? '🟢 Alcista' : sig.macro === 'bearish' ? '🔴 Bajista' : '⚪ Neutral'}`
    : '';
  const pullbackLine = sig.pullback
    ? `\n🎯 <b>Pullback:</b> ${sig.pullback}`
    : '';

  // Razones
  const reasonsLine = sig.reasons && sig.reasons.length > 0
    ? `\n🔍 <b>Confluencia:</b> ${sig.reasons.slice(0, 5).join(', ')}`
    : '';

  return `${header}

🕐 <b>Hora MX:</b> ${time}${macroLine}${pullbackLine}${reasonsLine}

💰 <b>Niveles de operación:</b>
  • Entrada:  <code>${fp(sig.entry)}</code>
  • Stop:     <code>${fp(sig.sl)}</code>
  • Target 1: <code>${fp(sig.t1)}</code>
  • Target 2: <code>${fp(sig.t2)}</code>
  • R:R:      <code>${sig.rr || '—'}</code>
  • ATR(14):  <code>${fp(sig.atr)}</code>

📋 <b>Condiciones activas:</b>
  ${r.fldDir      ? '✅' : '❌'} Hurst FLD (${r.fldDir || '—'})
  ${r.fibOk       ? '✅' : '❌'} Fibonacci Bounce en nivel clave
  ${r.pvOk        ? '✅' : '❌'} Confluencia Pivote (±0.3%)
  ${r.w1ok        ? '✅' : '❌'} Onda de Elliott detectada
  ${r.rsiVolumeOk ? '✅' : '❌'} RSI dinámico + Volumen confirmado
  ${r.tfMayorOk   ? '✅' : '❌'} Timeframe mayor alineado
  ${r.macdOk      ? '✅' : '❌'} MACD confirmando dirección
  ${r.adxOk       ? '✅' : '❌'} ADX+DI en tendencia + dirección correcta

⚠️ <i>Sistema automático v8.0 con ML+Regime. Valida siempre con tu análisis.</i>`;
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
