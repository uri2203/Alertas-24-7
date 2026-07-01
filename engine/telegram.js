// ═══════════════════════════════════════════════════════════════
//  engine/telegram.js  —  Trading Dashboard PRO v8.0 HUNTER
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

  // Quality badge
  const qualityEmoji = sig.quality === 'elite' ? '🏆' : '💪';

  // News alert
  const newsScore = sig.newsScore || 0;
  const newsLine = newsScore >= 75
    ? `\n🚨 <b>NOTICIA EXTREMA:</b> ${newsScore}/100 — Movimiento violento detectado`
    : newsScore >= 50
    ? `\n⚡ <b>NOTICIA ALTA:</b> ${newsScore}/100 — Alta volatilidad`
    : newsScore >= 25
    ? `\n📰 <b>Noticia moderada:</b> ${newsScore}/100`
    : '';

  // Agent sizing
  const sizing = sig.agentSizing || { multiplier: 1.0, label: 'NORMAL' };
  const sizingLine = sizing.multiplier >= 2.5
    ? `\n🦈 <b>ELITE HUNTER:</b> ${sizing.label} (${sizing.multiplier}x posición)`
    : sizing.multiplier >= 2.0
    ? `\n🦈 <b>HUNTER MODE:</b> ${sizing.label} (${sizing.multiplier}x posición)`
    : sizing.multiplier >= 1.5
    ? `\n🎯 <b>Conviction:</b> ${sizing.label} (${sizing.multiplier}x)`
    : '';

  // SL/TP adjustment for news
  const newsAdj = sig.newsSLAdjustment;
  const newsAdjLine = newsAdj
    ? `\n⚡ <b>News SL/TP:</b> ${newsAdj.label}`
    : '';

  // Macro
  const macroLine = sig.macro
    ? `\n📈 <b>Macro:</b> ${sig.macro === 'bullish' ? '🟢 Alcista' : sig.macro === 'bearish' ? '🔴 Bajista' : '⚪ Neutral'}`
    : '';

  // Pullback zone
  const pullbackLine = sig.pullback
    ? `\n🎯 <b>Pullback:</b> ${sig.pullback}`
    : '';

  // Reasons
  const reasonsLine = sig.reasons && sig.reasons.length > 0
    ? `\n🔍 <b>Confluencia:</b> ${sig.reasons.slice(0, 5).join(', ')}`
    : '';

  // Regime
  const regimeLine = sig.regime
    ? `\n📊 <b>Regime:</b> ${sig.regime}`
    : '';

  // ML
  const mlLine = sig.mlConfidence
    ? `\n🤖 <b>ML:</b> ${(sig.mlConfidence * 100).toFixed(0)}% confianza`
    : '';

  return `${emoji} <b>SEÑAL ${sig.signal} — ${sym} ${tf.toUpperCase()}</b>
${qualityEmoji} <b>Calidad:</b> ${sig.quality?.toUpperCase()} (${sig.score}/100)${sizingLine}${newsLine}

🕐 <b>Hora MX:</b> ${time}${macroLine}${pullbackLine}${regimeLine}${mlLine}${reasonsLine}

💰 <b>Niveles:</b>
  • Entrada:  <code>${fp(sig.entry)}</code>
  • Stop:     <code>${fp(sig.sl)}</code>${newsAdjLine}
  • Target 1: <code>${fp(sig.t1)}</code>
  • Target 2: <code>${fp(sig.t2)}</code>
  • R:R:      <code>${sig.rr || '—'}</code>
  • ATR(14):  <code>${fp(sig.atr)}</code>

⚠️ <i>Sistema automático v8.0 ELITE HUNTER. Valida siempre.</i>`;
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
