// ═══════════════════════════════════════════════════════════════
//  engine/telegram.js
// ═══════════════════════════════════════════════════════════════

const fp = v => {
  if (!v || isNaN(v)) return '—';
  return v > 100
    ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : v.toFixed(4);
};

export function buildAlertMessage(sym, tf, sig) {
  const emoji = sig.signal === 'LONG' ? '🟢' : '🔴';
  const time  = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

  return `${emoji} <b>SEÑAL ${sig.signal} — ${sym} ${tf.toUpperCase()}</b>

🕐 <b>Hora MX:</b> ${time}
📊 <b>Confluencia:</b> ${sig.score}/${sig.max} condiciones
${sig.dir === 'up' ? '▲ Dirección: ALCISTA' : '▼ Dirección: BAJISTA'}

💰 <b>Niveles de operación:</b>
  • Entrada:  <code>${fp(sig.entry)}</code>
  • Stop:     <code>${fp(sig.sl)}</code>
  • Target 1: <code>${fp(sig.t1)}</code>
  • Target 2: <code>${fp(sig.t2)}</code>
  • VPOC:     <code>${fp(sig.vpoc)}</code>

📋 <b>Condiciones activas:</b>
  ${sig.rules?.fldDir   ? '✅' : '❌'} Hurst FLD (${sig.rules?.fldDir || '—'})
  ${sig.rules?.inFib    ? '✅' : '❌'} Zona Fibonacci 38.2–61.8%
  ${sig.rules?.pvOk     ? '✅' : '❌'} Confluencia Pivote
  ${sig.rules?.nearVPOC ? '✅' : '❌'} Proximidad VPOC

⚠️ <i>Sistema automático. Valida siempre con tu análisis personal.</i>`;
}

export async function sendTelegram(token, chatId, text) {
  try {
    const { default: fetch } = await import('node-fetch');
    const res  = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
