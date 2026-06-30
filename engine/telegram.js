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
  const r     = sig.rules || {};

  // Encabezado especial si es senal de divergencia
  const header = isDivergence
    ? `📐 <b>DIVERGENCIA RSI — ${sig.signal} ${sym} ${tf.toUpperCase()}</b>`
    : `${emoji} <b>SEÑAL ${sig.signal} — ${sym} ${tf.toUpperCase()}</b>`;

  const divLine = sig.divergence
    ? sig.divValid
      ? `\n📐 <b>Divergencia VALIDADA:</b> ${sig.divergence === 'bullish' ? '🟢 Alcista (MACD+ADX confirman)' : '🔴 Bajista (MACD+ADX confirman)'}`
      : `\n⚠️ <b>Divergencia detectada pero SIN confirmación:</b> ${sig.divergence === 'bullish' ? '🟢 Alcista' : '🔴 Bajista'} (requiere MACD+ADX)`
    : '';

  // ML + Regime + Agent info
  const mlLine = sig.mlConfidence
    ? `\n🤖 <b>ML Confidence:</b> ${(sig.mlConfidence * 100).toFixed(0)}%`
    : '';
  const regimeLine = sig.regime
    ? `\n📊 <b>Régimen:</b> ${sig.regime}${sig.regimeConfidence ? ` (${(sig.regimeConfidence * 100).toFixed(0)}%)` : ''}`
    : '';
  const agentLine = sig.agentDecision
    ? `\n🧠 <b>RL Agent:</b> ${sig.agentDecision.action} (${(sig.agentDecision.confidence * 100).toFixed(0)}%)`
    : '';

  return `${header}

🕐 <b>Hora MX:</b> ${time}
📊 <b>Score:</b> ${sig.score}/${sig.max} (ponderado)
${sig.dir === 'up' ? '▲ Dirección: ALCISTA' : '▼ Dirección: BAJISTA'}${divLine}${mlLine}${regimeLine}${agentLine}

💰 <b>Niveles de operación:</b>
  • Entrada:  <code>${fp(sig.entry)}</code>
  • Stop:     <code>${fp(sig.sl)}</code>
  • Target 1: <code>${fp(sig.t1)}</code>
  • Target 2: <code>${fp(sig.t2)}</code>
  • VPOC:     <code>${fp(sig.vpoc)}</code>
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
