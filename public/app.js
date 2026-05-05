'use strict';

const safe = (fn, fallback = null) => { try { return fn(); } catch (e) { console.warn('[SAFE]', e.message); return fallback; } };
const safeAsync = async (fn, fallback = null) => { try { return await fn(); } catch (e) { console.warn('[SAFE-ASYNC]', e.message); return fallback; } };
const isValid = v => v !== null && v !== undefined && !isNaN(v) && isFinite(v);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const THEMES = [
  { id:'',              nm:'Slate',     bg:'#0e1117', acc:'#3d7eff' },
  { id:'th-midnight',   nm:'Midnight',  bg:'#0b0b0b', acc:'#2962ff' },
  { id:'th-arctic',     nm:'Arctic',    bg:'#eef3fb', acc:'#1a5fff' },
  { id:'th-parchment',  nm:'Parchment', bg:'#f5f0e6', acc:'#a85000' },
];
let curTheme = localStorage.getItem('tdp-theme') || 'th-midnight';

function applyTheme(id) {
  curTheme = id; localStorage.setItem('tdp-theme', id);
  const app = document.getElementById('APP');
  if(!app) return;
  THEMES.forEach(t => { if (t.id) app.classList.remove(t.id); });
  if (id) app.classList.add(id);
  buildSwatches('THS'); buildSwatches('LTH');
  const bg = THEMES.find(t => t.id === id)?.bg || '#0b0b0b';
  if (chart) chart.applyOptions({ layout: { background: { type:'solid', color: bg } } });
}

function buildSwatches(cid) {
  const c = document.getElementById(cid); if (!c) return;
  c.innerHTML = THEMES.map(t => `<div class="tsw${curTheme===t.id?' on':''}" title="${t.nm}" style="background:${t.bg};box-shadow:inset 0 0 0 3px ${t.acc}40" onclick="applyTheme('${t.id}')"></div>`).join('');
}

let pwdHash = null;
async function sha256(msg) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function initAuth() {
  buildSwatches('LTH');
  const app = document.getElementById('APP');
  if (curTheme && app) app.classList.add(curTheme);
  
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    pwdHash = d.passwordHash;
  } catch {
    pwdHash = await sha256('trading2025');
  }

  if (sessionStorage.getItem('tdp-auth') === '1') {
    showApp();
  } else {
    document.getElementById('PI').focus();
    document.getElementById('BTN-LOGIN').onclick = doLogin;
    document.getElementById('PI').onkeydown = (e) => { if(e.key === 'Enter') doLogin(); };
  }
}

async function doLogin() {
  const v = document.getElementById('PI').value || '';
  if (!v) return;
  if (await sha256(v) === pwdHash) {
    sessionStorage.setItem('tdp-auth','1'); 
    showApp();
  } else {
    document.getElementById('LE').textContent = 'Contraseña incorrecta';
    document.getElementById('PI').value = '';
    document.getElementById('PI').focus();
  }
}

function showApp() {
  document.getElementById('LS').style.display = 'none';
  document.getElementById('APP').style.display = 'grid';
  buildSwatches('THS');
  
  bindEvents();
  setTimeout(initDashboard, 150); // Garantía de pintado CSS Grid
}

function doLogout() { sessionStorage.removeItem('tdp-auth'); location.reload(); }

const TFC = {
  '1m':  { deg:'Sub-Minuette', lbl:['i','ii','iii','iv','v'],            hp:[15,30,60], ewCol:'#22d3ee', ewWidth:1.0 },
  '5m':  { deg:'Minuette',     lbl:['ⅰ','ⅱ','ⅲ','ⅳ','ⅴ'],            hp:[20,40,80], ewCol:'#38bdf8', ewWidth:1.2 },
  '15m': { deg:'Minute',       lbl:['①','②','③','④','⑤'],             hp:[20,40,80], ewCol:'#a78bfa', ewWidth:1.4 },
  '1h':  { deg:'Minor',        lbl:['[1]','[2]','[3]','[4]','[5]'],      hp:[10,20,40], ewCol:'#c084fc', ewWidth:1.6 },
  '4h':  { deg:'Intermediate', lbl:['(1)','(2)','(3)','(4)','(5)'],      hp:[8,16,32],  ewCol:'#e879f9', ewWidth:1.8 },
  '1d':  { deg:'Primary',      lbl:['I','II','III','IV','V'],             hp:[5,10,20],  ewCol:'#fbbf24', ewWidth:2.0 },
};

const MC = {
  scalp:{ tfs:['1m','5m','15m'], dTF:'5m', lrs:['pv','fb','hr','sess','vpoc'], lC:{pv:'#f59e0b',fb:'#26a69a',hr:'#ef5350',sess:'#06b6d4',vpoc:'#9333ea'}, lL:{pv:'Pivotes',fb:'Fibonacci',hr:'Hurst',sess:'Sesiones',vpoc:'VPOC'} },
  swing:{ tfs:['15m','1h','4h','1d'], dTF:'1h', lrs:['pv','fb','hr','ew','sess','vpoc'], lC:{pv:'#f59e0b',fb:'#26a69a',hr:'#2962ff',ew:'#9333ea',sess:'#06b6d4',vpoc:'#ec4899'}, lL:{pv:'Pivotes',fb:'Fibonacci',hr:'Hurst',ew:'Elliott',sess:'Sesiones',vpoc:'VPOC'} },
};

let curMode = 'scalp', curTF = '5m', curSym = 'BTCUSDT';
let CC = {}, chart, cSer, vSer, ws;
let xSer = [], pLines = [], ewLines = [], ewMarkersBuf = [];
let SH = { pv:true, fb:true, hr:true, ew:true, sess:true, vpoc:true };
let wsRD = 1000, wsT = null, curSig = { signal:null, entry:null, sl:null, t1:null, t2:null }, renderDebounce = null;

const fp = v => isValid(v) ? (v > 100 ? v.toLocaleString('en-US',{maximumFractionDigits:0}) : v.toFixed(4)) : '—';
const fv = v => isValid(v) ? (v > 1e9 ? (v/1e9).toFixed(2)+'B' : v > 1e6 ? (v/1e6).toFixed(2)+'M' : v > 1e3 ? (v/1e3).toFixed(1)+'K' : v.toFixed(0)) : '—';
const ftl = ms => { if (ms <= 0) return 'cerrando...'; const s = Math.floor(ms/1000), d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60); return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`; };

function ema(v, p) { const k = 2/(p+1), r = new Array(v.length).fill(null); if (p > v.length) return r; let s = 0; for (let i = 0; i < p; i++) s += v[i]; r[p-1] = s/p; for (let i = p; i < v.length; i++) r[i] = v[i]*k + r[i-1]*(1-k); return r; }
function fldC(cc, p) { const h = Math.floor(p/2), o = []; for (let i = h; i < cc.length; i++) o.push({time: cc[i].time, value: cc[i-h].close}); return o; }
function cmaC(cc, p) { const c = cc.map(x => x.close), e1 = ema(c, Math.floor(p/2)), e2 = ema(c, p), o = []; for (let i = p-1; i < cc.length; i++) { if (e1[i] != null && e2[i] != null) o.push({time: cc[i].time, value: 2*e1[i] - e2[i]}); } return o; }
function calcPiv(cc) { const n = cc.length; if (n < 8) return null; const s = cc.slice(-Math.min(60, n-4), -3); const H = Math.max(...s.map(c => c.high)), L = Math.min(...s.map(c => c.low)), C = cc[n-4].close, PP = (H+L+C)/3; return { PP, R1: 2*PP-L, R2: PP+H-L, S1: 2*PP-H, S2: PP-(H-L) }; }
function calcFib(cc, lb=150) { const s = cc.slice(-Math.min(lb, cc.length)); const H = Math.max(...s.map(c => c.high)), L = Math.min(...s.map(c => c.low)), d = H-L; return { H, L, r236: H-d*.236, r382: H-d*.382, r500: H-d*.5, r618: H-d*.618, r786: H-d*.786, e1618: H+d*.618 }; }
function calcVPOC(cc, bk=50) { if (!cc || cc.length < 10) return null; const H = Math.max(...cc.map(c => c.high)), L = Math.min(...cc.map(c => c.low)); if (H === L) return L; const st = (H-L)/bk; const bins = new Array(bk).fill(0); cc.forEach(c => { bins[Math.min(bk-1, Math.floor(((c.high+c.low)/2 - L)/st))] += c.vol; }); const mx = bins.indexOf(Math.max(...bins)); return L + (mx+0.5)*st; }

function getSessLevels(cc) { const ts = new Date(); ts.setUTCHours(0,0,0,0); const t0 = ts.getTime()/1000; const td = cc.filter(c => c.time >= t0); if (!td.length) return null; const hl = arr => arr.length ? { H: Math.max(...arr.map(c => c.high)), L: Math.min(...arr.map(c => c.low)) } : null; return { asia: hl(td.filter(c => new Date(c.time*1000).getUTCHours() < 9)), lon: hl(td.filter(c => { const h = new Date(c.time*1000).getUTCHours(); return h >= 8 && h < 17; })), ny: hl(td.filter(c => { const h = new Date(c.time*1000).getUTCHours(); return h >= 13 && h < 21; })) }; }
function swings(cc, lb) { const o = []; for (let i = lb; i < cc.length-lb; i++) { let h = true, l = true; for (let j = 1; j <= lb; j++) { if (cc[i-j].high >= cc[i].high || cc[i+j].high >= cc[i].high) h = false; if (cc[i-j].low <= cc[i].low || cc[i+j].low <= cc[i].low) l = false; } if (h) o.push({time: cc[i].time, p: cc[i].high, t: 'H'}); if (l) o.push({time: cc[i].time, p: cc[i].low, t: 'L'}); } return o.sort((a,b) => a.time-b.time); }

function detectEW(cc, tf) {
  const lb = Math.max(3, Math.floor(cc.length / 35)); const sw = swings(cc, lb); const cfg = TFC[tf] || TFC['1h']; const found = [];
  for (let i = 0; i + 4 < sw.length; i++) {
    const w = sw.slice(i, i + 6); let alt = true;
    for (let j = 1; j < w.length; j++) if (w[j].t === w[j-1].t) { alt = false; break; }
    if (!alt) continue;
    const up = w[0].t === 'L';
    if (up && w.length >= 5) {
      const w1 = w[1].p - w[0].p; if (w1 <= 0) continue;
      const w2r = (w[1].p - w[2].p) / w1; if (w2r < .3 || w2r > .82) continue;
      const w3 = w[3].p - w[2].p; if (w3 < w1 * .88) continue;
      const w4r = (w[3].p - w[4].p) / w3; if (w4r < .18 || w4r > .65) continue;
      if (w[4].p <= w[1].p) continue;
      found.push({ pts: w.slice(0, Math.min(6, w.length)), dir: 'up', w1, w2r, w3ext: w3/w1, w4r, lbl: cfg.lbl, deg: cfg.deg, origin: w[0].p, ewCol: cfg.ewCol, ewWidth: cfg.ewWidth, tf });
    }
    if (!up && w.length >= 5) {
      const w1 = w[0].p - w[1].p; if (w1 <= 0) continue;
      const w2r = (w[2].p - w[1].p) / w1; if (w2r < .3 || w2r > .82) continue;
      const w3 = w[2].p - w[3].p; if (w3 < w1 * .88) continue;
      const w4r = (w[4].p - w[3].p) / w3; if (w4r < .18 || w4r > .65) continue;
      if (w[4].p >= w[1].p) continue;
      found.push({ pts: w.slice(0, 5), dir: 'dn', w1, w2r, w3ext: w3/w1, w4r, lbl: cfg.lbl, deg: cfg.deg, origin: w[0].p, ewCol: cfg.ewCol, ewWidth: cfg.ewWidth, tf });
    }
  }
  return found.slice(-3);
}

function sessStatus() { const h = new Date().getUTCHours(), m = new Date().getUTCMinutes(), t = h*60+m; return { asia: t < 540, lon: t >= 480 && t < 1020, ny: t >= 780 && t < 1260 }; }
function updateSess() { const s = sessStatus(); document.getElementById('SESS').innerHTML = `<div class="sb sb-a${s.asia?'':' off'}">ASIA</div><div class="sb sb-l${s.lon?'':' off'}">LON</div><div class="sb sb-n${s.ny?'':' off'}">NY</div>`; }
setInterval(updateSess, 60000);

function renderMacro(id, O, H, L, C, vol, prog, tl) {
  const pct = (C-O)/O*100, isBull = C >= O, isDoji = Math.abs(pct) < 0.05, range = H-L || 1;
  const bh = Math.max(3, Math.abs(C-O)/range*52), wth = Math.max(2, (H-Math.max(O,C))/range*52), wbh = Math.max(2, (Math.min(O,C)-L)/range*52);
  document.getElementById('WT-'+id).style.height = wth+'px';
  document.getElementById('WB-'+id).style.height = wbh+'px';
  const b = document.getElementById('CB-'+id); b.style.height = bh+'px'; b.className = `cb ${isDoji?'doji':isBull?'bull':'bear'}`;
  const pe = document.getElementById('PCT-'+id); pe.textContent = (pct>=0?'+':'')+pct.toFixed(2)+'%'; pe.className = `mp-pct ${isBull?'up':'dn'}`;
  ['O','H','L','C'].forEach((k,i) => { const el = document.getElementById(k+'-'+id); if (el) el.textContent = fp([O,H,L,C][i]); });
  document.getElementById('PG-'+id).style.width = Math.min(100, Math.max(0, prog))+'%';
  const tlEl = document.getElementById('TL-'+id); if (tlEl) tlEl.textContent = tl;
  const vlEl = document.getElementById('VL-'+id); if (vlEl) vlEl.textContent = 'Vol: '+fv(vol);
}

async function loadMacros(sym) {
  for (const [iv, id] of [['1d','1d'], ['1w','1w'], ['1M','1M']]) {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${iv}&limit=2`);
      const d = await r.json();
      if (!Array.isArray(d) || !d.length) continue;
      const k = d[d.length-1], now = Date.now();
      renderMacro(id, +k[1], +k[2], +k[3], +k[4], +k[5], (now-+k[0])/(+k[6]-+k[0])*100, ftl(+k[6]-now));
    } catch(e){}
    await new Promise(r => setTimeout(r, 80));
  }
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1M&limit=13`);
    const d = await r.json();
    if (!Array.isArray(d) || d.length < 12) return;
    const yc = d.slice(-12), O = +yc[0][1], H = Math.max(...yc.map(k => +k[2])), L = Math.min(...yc.map(k => +k[3])), C = +yc[yc.length-1][4], vol = yc.reduce((s,k) => s+(+k[5]), 0);
    const now = new Date(), st = new Date(now.getFullYear(), 0, 1), prog = (now-st)/(365.25*864e5)*100;
    renderMacro('1Y', O, H, L, C, vol, prog, `${365-Math.floor((now-st)/864e5)}d`);
  } catch(e){}
}

function liveUpdateMacro(price) {
  ['1d','1w','1M','1Y'].forEach(id => {
    const oe = document.getElementById('O-'+id); if (!oe || oe.textContent === '—') return;
    const O = parseFloat(oe.textContent.replace(/,/g,'')); if (!isValid(O)) return;
    document.getElementById('C-'+id).textContent = fp(price);
    const he = document.getElementById('H-'+id), le = document.getElementById('L-'+id);
    const cH = parseFloat(he.textContent.replace(/,/g,'')) || price, cL = parseFloat(le.textContent.replace(/,/g,'')) || price;
    if (price > cH) he.textContent = fp(price);
    if (price < cL) le.textContent = fp(price);
    const H2 = Math.max(cH, price), L2 = Math.min(cL, price), range = H2-L2 || 1;
    const pct = (price-O)/O*100;
    const pe = document.getElementById('PCT-'+id); pe.textContent = (pct>=0?'+':'')+pct.toFixed(2)+'%'; pe.className = `mp-pct ${pct>=0?'up':'dn'}`;
    const b = document.getElementById('CB-'+id); b.style.height = Math.max(3, Math.abs(price-O)/range*52)+'px'; b.className = `cb ${pct>=0?'bull':'bear'}`;
  });
}

// ═══════════════════════════════════════════════════════════════
//  CHART (MONTAJE DE BAJO NIVEL)
// ═══════════════════════════════════════════════════════════════
function initChart() {
  const container = document.getElementById('CW');
  
  const w = container.clientWidth;
  const h = container.clientHeight;

  // Bloqueo WebGL: Si el layout aún está en 0, no inyectes nada. Reintenta.
  if (w < 50 || h < 50) {
    setTimeout(initChart, 100);
    return;
  }

  container.innerHTML = '';
  chart = LightweightCharts.createChart(container, {
    width: w,
    height: h,
    layout: { background: { type:'solid', color:'transparent' }, textColor: 'rgba(150,160,180,.8)' },
    grid: { vertLines: { color:'rgba(255,255,255,.03)' }, horzLines: { color:'rgba(255,255,255,.03)' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor:'rgba(255,255,255,.07)', scaleMargins:{top:.05,bottom:.2} },
    timeScale: { borderColor:'rgba(255,255,255,.07)', timeVisible:true, secondsVisible:false },
  });
  
  cSer = chart.addCandlestickSeries({ upColor:'#26a69a', downColor:'#ef5350', borderUpColor:'#26a69a', borderDownColor:'#ef5350', wickUpColor:'#26a69a', wickDownColor:'#ef5350' });
  vSer = chart.addHistogramSeries({ priceScaleId:'vol', scaleMargins:{top:.85,bottom:0} });
  chart.priceScale('vol').applyOptions({ scaleMargins:{top:.85,bottom:0} });
  
  new ResizeObserver((entries) => {
    if (entries.length === 0 || !chart) return;
    const r = entries[0].contentRect;
    if (r.width > 50 && r.height > 50) chart.applyOptions({ width: r.width, height: r.height });
  }).observe(container);

  if (CC[curTF]) setChartData();
}

function clearOvr() {
  pLines.forEach(pl => { try { cSer.removePriceLine(pl); } catch(e) {} }); pLines = [];
  xSer.forEach(s => { try { chart.removeSeries(s); } catch(e) {} }); xSer = [];
  ewLines.forEach(s => { try { chart.removeSeries(s); } catch(e) {} }); ewLines = [];
  ewMarkersBuf = [];
  if (cSer) cSer.setMarkers([]);
}

function renderElliottWaves(cc, tf) {
  if (!SH.ew || !cc || !cc.length) return;
  const pats = detectEW(cc, tf);
  if (!pats || !pats.length) return;
  const cfg = TFC[tf] || TFC['1h'];

  pats.forEach((pat, patIdx) => {
    if (!pat.pts || pat.pts.length < 2) return;
    const lineData = [];
    const markers = [];

    pat.pts.forEach((pt, i) => {
      if (!pt) return;
      lineData.push({ time: pt.time, value: pt.p });
      markers.push({ time: pt.time, position: pt.t === 'H' ? 'aboveBar' : 'belowBar', color: pat.ewCol, shape: pt.t === 'H' ? 'arrowDown' : 'arrowUp', text: pat.lbl[i] || '', size: Math.max(1, Math.min(3, cfg.ewWidth)) });
    });

    if (lineData.length >= 2) {
      const lineSer = chart.addLineSeries({ color: pat.ewCol, lineWidth: cfg.ewWidth, lineStyle: pat.pts.length < 5 ? LightweightCharts.LineStyle.Dashed : LightweightCharts.LineStyle.Solid, title: `EW ${cfg.deg}`, priceLineVisible: false, lastValueVisible: false });
      lineSer.setData(lineData); xSer.push(lineSer); ewLines.push(lineSer);
    }

    if (pat.pts.length === 5 && pat.dir) {
      const lastPt = pat.pts[4], prevPt = pat.pts[3], w3Len = Math.abs(pat.pts[3].p - pat.pts[2].p);
      const projLen = w3Len * 0.618, projPrice = pat.dir === 'up' ? lastPt.p + projLen : lastPt.p - projLen;
      const lastCandle = cc[cc.length - 1];
      if (lastCandle && lastCandle.time > lastPt.time) {
        const projSer = chart.addLineSeries({ color: pat.ewCol + '60', lineWidth: cfg.ewWidth * 0.7, lineStyle: LightweightCharts.LineStyle.Dashed, title: `EW ${cfg.deg} proj`, priceLineVisible: false, lastValueVisible: false });
        projSer.setData([{ time: lastPt.time, value: lastPt.p }, { time: lastCandle.time, value: projPrice }]);
        xSer.push(projSer); ewLines.push(projSer);
      }
    }
    if (markers.length) ewMarkersBuf.push(...markers);
  });
  if (cSer && ewMarkersBuf.length) cSer.setMarkers(ewMarkersBuf.slice().sort((a,b) => a.time - b.time));
}

function renderOvr() {
  if (renderDebounce) clearTimeout(renderDebounce);
  renderDebounce = setTimeout(_renderOvr, 250);
}

function _renderOvr() {
  clearOvr();
  const cc = CC[curTF]; if (!cc || !cc.length) return;
  const cfg = TFC[curTF] || TFC['1h'];
  const pv = calcPiv(cc), fb = calcFib(cc);

  const addPL = (v, c, t, sty = LightweightCharts.LineStyle.Dashed) => {
    if (!isValid(v)) return;
    pLines.push(cSer.createPriceLine({ price: v, color: c, lineWidth: 1, lineStyle: sty, axisLabelVisible: true, title: t }));
  };

  if (SH.pv && pv) {
    [[pv.PP,'#f59e0b','PP'],[pv.R1,'#ef5350','R1'],[pv.R2,'#ef5350','R2'],[pv.S1,'#26a69a','S1'],[pv.S2,'#26a69a','S2']].forEach(([v,c,t]) => addPL(v,c,t));
    document.getElementById('IPP').textContent = fp(pv.PP);
  }

  if (SH.fb && fb) {
    [[fb.H,'#26a69a','100%'],[fb.r786,'rgba(38,166,154,.45)','78.6'],[fb.r618,'#26a69a','61.8'],[fb.r500,'rgba(38,166,154,.3)','50.0'],[fb.r382,'#26a69a','38.2'],[fb.r236,'rgba(38,166,154,.2)','23.6'],[fb.L,'#26a69a','0%'],[fb.e1618,'rgba(38,166,154,.25)','161.8']].forEach(([v,c,t]) => addPL(v,c,t,LightweightCharts.LineStyle.Dotted));
    document.getElementById('IF6').textContent = fp(fb.r618); document.getElementById('IF3').textContent = fp(fb.r382);
  }

  if (SH.hr) {
    const cols = [{s:'rgba(61,126,255,.9)',c:'rgba(61,126,255,.18)'},{s:'rgba(139,92,246,.85)',c:'rgba(139,92,246,.15)'}];
    cfg.hp.slice(0,2).forEach((p,i) => {
      if (cc.length < p*2) return;
      const fd = fldC(cc,p), cm = cmaC(cc,p);
      if (fd.length) { const s = chart.addLineSeries({ color: cols[i].s, lineWidth: 1.5, title: `FLD-${p}`, priceLineVisible: false, lastValueVisible: true }); s.setData(fd); xSer.push(s); }
      if (cm.length) { const s = chart.addLineSeries({ color: cols[i].c, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.SparseDotted, priceLineVisible: false, lastValueVisible: false }); s.setData(cm); xSer.push(s); }
    });
    const fa = fldC(cc, cfg.hp[0]), fb2 = fldC(cc, cfg.hp[1]);
    document.getElementById('FL1').textContent = `FLD-${cfg.hp[0]}`; document.getElementById('FL2').textContent = `FLD-${cfg.hp[1]}`;
    if (fa.length) document.getElementById('IFA').textContent = fp(fa[fa.length-1].value);
    if (fb2.length) document.getElementById('IFB').textContent = fp(fb2[fb2.length-1].value);
  }

  if (SH.sess) {
    const sl = getSessLevels(cc);
    if (sl) {
      [{d:sl.asia,c:'#06b6d4',n:'Asia'},{d:sl.lon,c:'#f59e0b',n:'LON'},{d:sl.ny,c:'#ef5350',n:'NY'}].forEach(({d,c,n}) => {
        if (!d) return;
        addPL(d.H, c, `${n}H`, LightweightCharts.LineStyle.LargeDashed); addPL(d.L, c, `${n}L`, LightweightCharts.LineStyle.LargeDashed);
      });
    }
  }

  if (SH.vpoc) {
    const vpoc = calcVPOC(cc.slice(-100));
    if (vpoc) { addPL(vpoc, '#9333ea', 'VPOC', LightweightCharts.LineStyle.Solid); document.getElementById('IVPC').textContent = fp(vpoc); }
  }

  if (SH.ew) renderElliottWaves(cc, curTF);
  runSignals();
}

function rSet(id, pass, txt) {
  const el = document.getElementById(id), tv = document.getElementById(id+'V');
  el.className = 'rule ' + (pass ? 'pass' : 'fail');
  el.querySelector('.ri').textContent = pass ? '✓' : '—';
  if (tv) tv.textContent = txt;
  return pass;
}

function runSignals() {
  const cc = CC[curTF]; if (!cc || !cc.length) return;
  const price = cc[cc.length-1].close, pv = calcPiv(cc), fb = calcFib(cc);
  const cfg = TFC[curTF] || TFC['1h'];
  const fa = fldC(cc, cfg.hp[0]), fb2 = fldC(cc, cfg.hp[1]);
  const fldA = fa.length ? fa[fa.length-1].value : null, fldB = fb2.length ? fb2[fb2.length-1].value : null;
  const rsi = calcRSI(cc);
  
  const el = document.getElementById('IRSI'); 
  if (el && rsi) {
    el.textContent = rsi.toFixed(1);
    el.className = `val ${rsi > 70 ? 'dn' : rsi < 30 ? 'up' : rsi > 50 ? 'up' : 'neu'}`;
  }
  if (curMode === 'scalp') doScalp(price, pv, fb, fldA, fldB);
  else doSwing(price, pv, fb, fldA, fldB);
}

function doScalp(price, pv, fb, fldA, fldB) {
  const p1h = CC['1h'] ? detectEW(CC['1h'], '1h').slice(-1)[0] : null;
  const p4h = CC['4h'] ? detectEW(CC['4h'], '4h').slice(-1)[0] : null;
  let htfDir = null, htfTxt = 'sin datos HTF';
  if (p1h && p4h && p1h.dir === p4h.dir) { htfDir = p1h.dir; htfTxt = `1H+4H ${p1h.dir==='up'?'▲ bull':'▼ bear'}`; }
  else if (p4h) { htfDir = p4h.dir; htfTxt = `4H ${p4h.dir==='up'?'▲':'▼'} (1H neutral)`; }
  const r0 = rSet('SR0', htfDir !== null, htfTxt);

  let fldDir = null, fldTxt = 'sin FLD';
  if (fldA && fldB) { const aa = price > fldA, ab = price > fldB; if (aa && ab) { fldDir = 'up'; fldTxt = 'sobre FLD-A y B ▲'; } else if (!aa && !ab) { fldDir = 'dn'; fldTxt = 'bajo FLD-A y B ▼'; } else fldTxt = 'entre FLDs — ruido'; }
  const r1 = rSet('SR1', fldDir !== null, fldTxt);

  const iF = fb && price >= fb.r618 && price <= fb.r382;
  const r2 = rSet('SR2', iF, iF ? 'zona 38.2–61.8% activa' : 'fuera de zona Fib');

  let pvOk = false, pvTxt = 'sin pivote';
  if (pv) for (const {v,n} of [{v:pv.PP,n:'PP'},{v:pv.R1,n:'R1'},{v:pv.S1,n:'S1'}]) if (Math.abs(price-v)/price < 0.005) { pvOk = true; pvTxt = `${n} (${fp(v)})`; break; }
  const r3 = rSet('SR3', pvOk, pvTxt);

  const sc = [r0, r1, iF, pvOk].filter(Boolean).length;
  document.getElementById('SNS').textContent = sc;
  for (let i = 0; i < 4; i++) document.getElementById('SD'+i).className = `sdot${i<sc?' ls':''}`;

  const dir = htfDir || fldB, badge = document.getElementById('SBDG');
  if (sc >= 3 && dir) {
    const up = dir === 'up';
    badge.className = `sig-badge ${up?'badge-long':'badge-short'}`;
    badge.innerHTML = `<span class="di ${up?'dl':'ds'}"></span>${sc}/4 — SEÑAL ${up?'LONG ▲':'SHORT ▼'}`;
    if (fb) setEntry(up?fb.r618:fb.r382, up?fb.L:fb.H, up?fb.r382:fb.r618, up?fb.r236:fb.r786, up?'LONG':'SHORT');
  } else {
    badge.className = 'sig-badge badge-wait';
    badge.innerHTML = `<span class="di dw"></span>${sc}/4 — esperando confluencia`;
  }

  const fc = (p, eid, esub) => {
    const el = document.getElementById(eid); if (!el) return;
    el.classList.remove('ld');
    if (!p) { el.textContent = '—'; el.className = 'bc-val'; return; }
    const up = p.dir === 'up';
    el.textContent = up ? '▲ BULL' : '▼ BEAR';
    el.className = `bc-val ${up?'up':'dn'}`;
    const se = document.getElementById(esub); if (se) se.textContent = `${p.lbl[p.pts.length-1]||'?'} · ${p.w3ext.toFixed(2)}×`;
  };
  fc(p1h, 'B1E', 'B1S'); fc(p4h, 'B4E', 'B4S');

  if (fldA) {
    const el = document.getElementById('B1F'); el.classList.remove('ld');
    const ab = price > fldA; el.textContent = ab ? '▲ SOBRE' : '▼ BAJO'; el.className = `bc-val ${ab?'up':'dn'}`;
    document.getElementById('B1FS').textContent = fp(fldA);
  }
  if (CC['4h']) {
    const fd4 = fldC(CC['4h'], TFC['4h'].hp[0]);
    if (fd4.length) {
      const v4 = fd4[fd4.length-1].value, ab4 = price > v4, el = document.getElementById('B4F');
      el.classList.remove('ld'); el.textContent = ab4 ? '▲ SOBRE' : '▼ BAJO'; el.className = `bc-val ${ab4?'up':'dn'}`;
      document.getElementById('B4FS').textContent = fp(v4);
    }
  }
}

function doSwing(price, pv, fb, fldA, fldB) {
  const tfs = ['15m','1h','4h','1d'], pats = {};
  tfs.forEach(tf => { const cc = CC[tf]; if (cc) { const p = detectEW(cc, tf); pats[tf] = p[p.length-1] || null; } });
  const dirs = tfs.map(tf => pats[tf] ? pats[tf].dir : null).filter(Boolean);
  const upC = dirs.filter(d => d === 'up').length, dnC = dirs.filter(d => d === 'dn').length;
  const aligned = upC >= 3 || dnC >= 3, mDir = upC >= 3 ? 'up' : dnC >= 3 ? 'dn' : upC > dnC ? 'up' : 'dn';
  const r0 = rSet('WR0', aligned, `${upC}▲/${dnC}▼ — ${aligned?'ALINEADOS':'divergencia'}`);

  let fldOk = false, fldTxt = 'sin FLD';
  if (fldA && fldB) { const aa = price > fldA, ab = price > fldB; fldOk = aa === ab; fldTxt = fldOk ? `ambos FLD ${aa?'▲':'▼'}` : 'entre FLDs'; }
  const r1 = rSet('WR1', fldOk, fldTxt);

  const iF = fb && price >= fb.r618 && price <= fb.r382;
  const r2 = rSet('WR2', iF, iF ? 'zona 38.2–61.8% activa' : 'fuera de zona dorada');

  let pvOk = false, pvTxt = 'sin pivote';
  if (pv) for (const {v,n} of [{v:pv.PP,n:'PP'},{v:pv.R1,n:'R1'},{v:pv.S1,n:'S1'},{v:pv.R2,n:'R2'},{v:pv.S2,n:'S2'}]) if (Math.abs(price-v)/price < 0.008) { pvOk = true; pvTxt = `${n} (${fp(v)})`; break; }
  const r3 = rSet('WR3', pvOk, pvTxt);

  const cp = pats[curTF]; let w1ok = true, w1txt = 'sin patrón';
  if (cp) { w1ok = cp.dir === 'up' ? price > cp.origin : price < cp.origin; w1txt = w1ok ? `W1 intacto (${fp(cp.origin)})` : '⚠ W1 violado'; }
  const r4 = rSet('WR4', w1ok, w1txt);

  const sc = [r0, r1, iF, pvOk, w1ok].filter(Boolean).length;
  document.getElementById('SNW').textContent = sc;
  for (let i = 0; i < 5; i++) document.getElementById('WD'+i).className = `sdot${i<sc?' lw':''}`;

  const badge = document.getElementById('WBDG');
  if (sc >= 4) {
    const up = mDir === 'up';
    badge.className = `sig-badge ${up?'badge-long':'badge-short'}`;
    badge.innerHTML = `<span class="di ${up?'dl':'ds'}"></span>${sc}/5 — SEÑAL ${up?'LONG ▲':'SHORT ▼'}`;
    if (fb) setEntry(up?fb.r618:fb.r382, up?fb.L:fb.H, up?fb.r382:fb.r618, up?fb.r236:fb.r786, up?'LONG':'SHORT');
  } else {
    badge.className = 'sig-badge badge-wait';
    badge.innerHTML = `<span class="di dw"></span>${sc}/5 — esperando confluencia`;
  }

  tfs.forEach(tf => {
    const mc = document.getElementById('mc-'+tf), mw = document.getElementById('mw-'+tf);
    if (!mc || !mw) return;
    const p = pats[tf];
    if (!p) { mw.textContent = 'sin patrón'; mw.className = 'mc-wave'; return; }
    const wn = Math.max(0, p.pts.length - 2);
    mw.textContent = `${p.lbl[wn]||'?'} ${p.dir==='up'?'▲':'▼'}`;
    mw.className = `mc-wave ${p.dir==='up'?'up':'dn'}`;
    const sub = mc.querySelector('.mc-sub'); if (sub) sub.textContent = `W3=${p.w3ext.toFixed(2)}×`;
  });
}

function setEntry(en, sl, t1, t2, sig) {
  curSig = { signal: sig, entry: en, sl, t1, t2 };
  document.getElementById('EEN').textContent = fp(en);
  document.getElementById('ESL').textContent = fp(sl);
  document.getElementById('ET1').textContent = fp(t1);
  document.getElementById('ET2').textContent = fp(t2);
}

// ═══════════════════════════════════════════════════════════════
//  SERVER POLLING
// ═══════════════════════════════════════════════════════════════
async function refreshScanner() {
  document.getElementById('SCLIST').innerHTML = '<div class="scan-load">Sincronizando con servidor...</div>';
  await pollServer();
}

function renderScanResults(signals) {
  const el = document.getElementById('SCLIST');
  if (!signals || !signals.length) {
    el.innerHTML = '<div class="scan-load" style="opacity:.5">Sin señales activas en servidor</div>'; return;
  }
  el.innerHTML = signals.map(s => {
    const isL = s.signal === 'LONG';
    const dots = Array(s.max).fill(0).map((_, i) => `<span class="scd${i < s.score ? (isL ? ' sg' : ' sl') : ''}"></span>`).join('');
    return `<div class="scan-card${isL ? ' sig-long' : ' sig-short'}" onclick="document.getElementById('SYM').value='${s.sym}';fullReload()">
      <div class="sc-top"><span class="sc-sym">${(s.sym || '').replace('USDT','')}</span><span class="sc-tf">${s.tf || ''}</span></div>
      <div class="sc-dots">${dots}</div>
      <div class="sc-dir ${isL ? 'up' : 'dn'}">${isL ? '▲ LONG' : '▼ SHORT'} · ${s.score}/${s.max}</div>
      <div class="sc-price">${fp(s.price)}</div>
      <div class="sc-detail">Entrada ${fp(s.entry)}</div>
    </div>`;
  }).join('');
}

async function pollServer() {
  try {
    const r = await fetch('/api/state');
    const d = await r.json();
    document.getElementById('EDOT').className = d.daemonActive ? 'edot on' : 'edot';
    let msg = `Servidor: Scan #${d.scanCount}`;
    if (d.isScanning) msg += ' (Buscando...)';
    else msg += ' (En espera)';
    document.getElementById('EMSG').textContent = msg;
    document.getElementById('ENG-NOTICE').className = 'eng-notice eng-ok';
    document.getElementById('ENG-TXT').textContent = '🌐 Motor 24/7 operando en el servidor. Alertas directas activas.';
    
    if (d.signals && Object.keys(d.signals).length > 0) renderScanResults(Object.values(d.signals));
    else renderScanResults([]);
    document.getElementById('SCTS').textContent = 'Act. ' + new Date().toLocaleTimeString('es-MX');
  } catch(e) {
    console.warn("Poll Failed");
  }
}

async function fetchCC(tf, sym) {
  const endpoints = ['https://data-api.binance.vision/api/v3/klines', 'https://api.binance.com/api/v3/klines', 'https://api1.binance.com/api/v3/klines'];
  for (const base of endpoints) {
    try {
      const r = await fetch(`${base}?symbol=${sym}&interval=${tf}&limit=300`);
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d)) return d.map(k => ({ time:+k[0]/1000, open:+k[1], high:+k[2], low:+k[3], close:+k[4], vol:+k[5] }));
      }
    } catch(e) {}
  }
  return null;
}

async function fullReload() {
  curSym = document.getElementById('SYM').value; CC = {};
  document.getElementById('CW-LOAD').classList.remove('H');
  
  if (ws) { try { ws.onclose = null; ws.close(); ws = null; } catch(e) {} }
  if (wsT) { clearTimeout(wsT); wsT = null; }
  setWS(false, 'Descargando...');

  const tfs = ['1m','5m','15m','1h','4h','1d'];
  const results = await Promise.all(tfs.map(tf => fetchCC(tf, curSym)));
  tfs.forEach((tf, i) => { if (results[i]) CC[tf] = results[i]; });
  await loadMacros(curSym);
  
  if(!chart) initChart();
  else setChartData();

  document.getElementById('CW-LOAD').classList.add('H');
  connectWS();

  clearInterval(window._mI); window._mI = setInterval(() => loadMacros(curSym), 60000);
  const cfg = JSON.parse(localStorage.getItem('tdp-tg') || '{}');
  if (cfg.token) {
    document.getElementById('TT').value = cfg.token;
    document.getElementById('TC').value = cfg.chatId || '';
    document.getElementById('BTN-TG').classList.add('ok');
  }
}

function setChartData() {
  const cc = CC[curTF]; if (!cc || !chart) return;
  cSer.setData(cc.map(c => ({time:c.time, open:c.open, high:c.high, low:c.low, close:c.close})));
  vSer.setData(cc.map(c => ({time:c.time, value:c.vol, color:c.close>=c.open?'rgba(38,166,154,.3)':'rgba(239,83,80,.3)'})));
  updatePrice(cc[cc.length-1].close);
  chart.timeScale().fitContent();
  renderOvr();
  document.querySelectorAll('.mc').forEach(c => c.classList.remove('act'));
  const ac = document.getElementById('mc-'+curTF); if (ac) ac.classList.add('act');
}

function connectWS() {
  try {
    ws = new WebSocket(`wss://stream.binance.com:9443/ws/${curSym.toLowerCase()}@kline_${curTF}`);
    ws.onopen = () => {
      wsRD = 1000; setWS(true, `En vivo · ${curTF.toUpperCase()} · ${curSym}`);
      if (CC[curTF] && CC[curTF].length) updatePrice(CC[curTF][CC[curTF].length-1].close);
    };
    ws.onmessage = (e) => {
      const k = JSON.parse(e.data).k;
      const bar = { time:+k.t/1000, open:+k.o, high:+k.h, low:+k.l, close:+k.c, vol:+k.v };
      if (cSer) {
        cSer.update({time:bar.time, open:bar.open, high:bar.high, low:bar.low, close:bar.close});
        vSer.update({time:bar.time, value:bar.vol, color:bar.close>=bar.open?'rgba(38,166,154,.3)':'rgba(239,83,80,.3)'});
      }
      const cc = CC[curTF];
      if (cc) {
        const last = cc[cc.length-1];
        if (last && last.time === bar.time) cc[cc.length-1] = bar;
        else { cc.push(bar); if (cc.length > 500) cc.shift(); }
      }
      updatePrice(bar.close); liveUpdateMacro(bar.close);
      document.getElementById('WTS').textContent = new Date(+k.t).toLocaleTimeString('es-MX');
      if (k.x) renderOvr();
    };
    ws.onerror = (err) => { console.log('WS error:', err); setWS(false, 'Error WS'); };
    ws.onclose = () => { setWS(false, `Recon. ${(wsRD/1e3).toFixed(0)}s`); wsT = setTimeout(() => { wsRD = Math.min(wsRD*1.5, 8000); connectWS(); }, wsRD); };
  } catch(e) {
    setWS(false, 'Error WS'); wsT = setTimeout(connectWS, wsRD);
  }
}

function updatePrice(p) { const f = fp(p); document.getElementById('PH').textContent = f; document.getElementById('IPR').textContent = f; }
function setWS(on, msg) { document.getElementById('WDOT').className = 'wdot' + (on ? ' on' : ''); document.getElementById('WMSG').textContent = msg; }

// ═══════════════════════════════════════════════════════════════
//  UI CONTROLS & BINDINGS
// ═══════════════════════════════════════════════════════════════
function setMode(m) {
  curMode = m; const mc = MC[m];
  document.getElementById('BMS').className = `mbn${m==='scalp'?' ms':''}`;
  document.getElementById('BMW').className = `mbn${m==='swing'?' mw':''}`;
  document.getElementById('PS').className = `panel${m==='scalp'?' on scalp-mode':''}`;
  document.getElementById('PW').className = `panel${m==='swing'?' on swing-mode':''}`;
  buildTFR(mc); buildLayR(mc); curTF = mc.dTF;
  if (m === 'swing') buildMTFG();
  setChartData(); connectWS();
}

function buildTFR(mc) {
  const container = document.getElementById('TFR');
  container.innerHTML = mc.tfs.map(tf => `<button class="tfb${mc.dTF===tf?' on':''}" data-tf="${tf}">${tf}</button>`).join('');
  container.querySelectorAll('.tfb').forEach(b => b.addEventListener('click', (e) => switchTF(e.target, e.target.getAttribute('data-tf'))));
}

function buildLayR(mc) {
  const container = document.getElementById('LAYR');
  container.innerHTML = mc.lrs.map(k => `<button class="ltog${SH[k]?'':' off'}" data-lay="${k}" style="border-color:${mc.lC[k]};color:${mc.lC[k]}">${mc.lL[k]}</button>`).join('');
  container.querySelectorAll('.ltog').forEach(b => b.addEventListener('click', (e) => togLay(e.target.getAttribute('data-lay'))));
}

function buildMTFG() {
  const tfs = ['15m','1h','4h','1d'];
  const container = document.getElementById('MTFG');
  container.innerHTML = tfs.map(tf => `<div class="mc${tf===curTF?' act':''}" id="mc-${tf}" data-tf="${tf}"><div class="mc-tf">${tf}</div><div class="mc-deg">${TFC[tf]?TFC[tf].deg:''}</div><div class="mc-wave ld" id="mw-${tf}">...</div><div class="mc-sub"></div></div>`).join('');
  container.querySelectorAll('.mc').forEach(c => c.addEventListener('click', (e) => switchTF(e.currentTarget, e.currentTarget.getAttribute('data-tf'))));
}

function switchTF(el, tf) {
  curTF = tf;
  document.querySelectorAll('.tfb').forEach(b => b.classList.remove('on'));
  if (el && el.classList) el.classList.add('on');
  setChartData(); connectWS();
}

function togLay(k) { SH[k] = !SH[k]; buildLayR(MC[curMode]); renderOvr(); }

function openM(id) { document.getElementById(id).style.display = 'flex'; }
function closeM(id) { document.getElementById(id).style.display = 'none'; }

function bindEvents() {
    document.getElementById('BMS').onclick = () => setMode('scalp');
    document.getElementById('BMW').onclick = () => setMode('swing');
    document.getElementById('BTN-TG').onclick = () => openM('TGM');
    document.getElementById('BTN-RM').onclick = () => { openM('RM'); fillRisk(); };
    document.getElementById('BTN-JM').onclick = () => { openM('JM'); renderJ(); };
    document.getElementById('BTN-LOGOUT').onclick = doLogout;
    document.getElementById('BTN-REFRESH').onclick = refreshScanner;
    
    // Modals
    document.getElementById('CLS-TGM').onclick = () => closeM('TGM');
    document.getElementById('CANC-TGM').onclick = () => closeM('TGM');
    document.getElementById('TEST-TGM').onclick = testTG;
    document.getElementById('SAVE-TGM').onclick = saveTG;

    document.getElementById('CLS-RM').onclick = () => closeM('RM');
    document.getElementById('CANC-RM').onclick = () => closeM('RM');
    document.getElementById('FILL-RM').onclick = fillRisk;
    
    ['RCAP','RPCT','REN','RSL','RT1','RT2'].forEach(id => {
        document.getElementById(id).addEventListener('input', calcR);
    });

    document.getElementById('CLS-JM').onclick = () => closeM('JM');
    document.getElementById('CANC-JM').onclick = () => closeM('JM');
    document.getElementById('ADD-JM').onclick = addTrade;
    document.getElementById('FILL-JM').onclick = fillJFromSig;
    document.getElementById('CLEAR-JM').onclick = clearJ;

    window.onclick = e => { if (e.target.classList.contains('ov')) e.target.style.display = 'none'; };
}

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
function initDashboard() {
  buildTFR(MC[curMode]); buildLayR(MC[curMode]);
  updateSess(); fullReload();
  pollServer(); setInterval(pollServer, 30000);
}

// ═══════════════════════════════════════════════════════════════
//  TELEGRAM MODAL & RISK & JOURNAL
// ═══════════════════════════════════════════════════════════════
async function testTG() {
  const t = document.getElementById('TT').value.trim(), c = document.getElementById('TC').value.trim();
  if (!t || !c) { showMst('TGST','err','Completa los campos'); return; }
  showMst('TGST','ok','Enviando...');
  try {
      const r = await fetch('/api/telegram', { method:'POST', headers:{'Content-Type':'application/json', 'Authorization': `Bearer ${pwdHash}`}, body: JSON.stringify({token:t, chatId:c, text:`✅ Test OK`}) });
      const d = await r.json();
      d.ok ? showMst('TGST','ok','✓ Telegram OK') : showMst('TGST','err','Error');
  } catch(e) { showMst('TGST','err','Error de red'); }
}

function saveTG() {
  const t = document.getElementById('TT').value.trim(), c = document.getElementById('TC').value.trim();
  if (!t || !c) { showMst('TGST','err','Completa token y Chat ID'); return; }
  localStorage.setItem('tdp-tg', JSON.stringify({token:t, chatId:c}));
  document.getElementById('BTN-TG').classList.add('ok'); closeM('TGM');
}

function showMst(id, type, msg) { const el = document.getElementById(id); el.textContent = msg; el.className = `m-st ${type}`; el.style.display = 'block'; }

function calcR() {
  const cap = parseFloat(document.getElementById('RCAP').value) || 0, pct = parseFloat(document.getElementById('RPCT').value) || 1;
  const en = parseFloat(document.getElementById('REN').value) || 0, sl = parseFloat(document.getElementById('RSL').value) || 0;
  const t1 = parseFloat(document.getElementById('RT1').value) || 0, t2 = parseFloat(document.getElementById('RT2').value) || 0;
  const rusd = cap * pct / 100, slD = en && sl ? Math.abs(en-sl) : 0, pos = slD ? rusd / slD * en : 0;
  const rr1 = slD && t1 ? Math.abs(t1-en) / slD : 0, rr2 = slD && t2 ? Math.abs(t2-en) / slD : 0;
  const g1 = pos && en && t1 ? pos * (Math.abs(t1-en)/en) : 0, g2 = pos && en && t2 ? pos * (Math.abs(t2-en)/en) : 0;
  document.getElementById('RRUSD').textContent = rusd ? `$${rusd.toFixed(2)}` : '—';
  document.getElementById('RRPOS').textContent = pos ? `$${pos.toFixed(0)}` : '—';
  document.getElementById('RRRR1').textContent = rr1 ? `${rr1.toFixed(2)}:1` : '—';
  document.getElementById('RRRR2').textContent = rr2 ? `${rr2.toFixed(2)}:1` : '—';
  document.getElementById('RRG1').textContent = g1 ? `$${g1.toFixed(2)}` : '—';
  document.getElementById('RRG2').textContent = g2 ? `$${g2.toFixed(2)}` : '—';
}

function fillRisk() {
  if (curSig.entry) {
    document.getElementById('REN').value = curSig.entry.toFixed(2); document.getElementById('RSL').value = curSig.sl.toFixed(2);
    document.getElementById('RT1').value = curSig.t1.toFixed(2); document.getElementById('RT2').value = curSig.t2.toFixed(2);
    calcR();
  }
}

const gT = () => safe(() => JSON.parse(localStorage.getItem('tdp-j') || '[]'), []);
const sT = t => safe(() => localStorage.setItem('tdp-j', JSON.stringify(t)));

function addTrade() {
  const sym = document.getElementById('JSYM').value.trim() || curSym, dir = document.getElementById('JDIR').value;
  const en = parseFloat(document.getElementById('JEN').value), ex = parseFloat(document.getElementById('JEX').value);
  const sz = parseFloat(document.getElementById('JSZ').value) || 1000, mod = document.getElementById('JMOD').value, nts = document.getElementById('JNTS').value;
  if (!en || !ex) return alert('Completa entrada y salida');
  const pp = dir === 'LONG' ? (ex-en)/en*100 : (en-ex)/en*100, pu = sz * pp / 100;
  const t = gT(); t.unshift({id:Date.now(), date:new Date().toLocaleDateString('es-MX'), sym, dir, en, ex, sz, pp, pu, mod, nts}); sT(t); renderJ();
  document.getElementById('JEN').value = ''; document.getElementById('JEX').value = ''; document.getElementById('JNTS').value = '';
}

function fillJFromSig() {
  document.getElementById('JSYM').value = curSym; document.getElementById('JDIR').value = curSig.signal || 'LONG';
  if (curSig.entry) document.getElementById('JEN').value = curSig.entry.toFixed(2);
}

window.deleteTrade = (id) => { sT(gT().filter(t => t.id !== id)); renderJ(); };
function clearJ() { if (confirm('¿Eliminar todos los trades?')) { sT([]); renderJ(); } }

function renderJ() {
  const t = gT(), wins = t.filter(x => x.pp > 0).length, tpnl = t.reduce((s,x) => s+x.pu, 0), best = t.length ? Math.max(...t.map(x => x.pu)) : 0;
  document.getElementById('JST').textContent = t.length; document.getElementById('JWR').textContent = t.length ? `${((wins/t.length)*100).toFixed(0)}%` : '—';
  document.getElementById('JPNL').textContent = t.length ? `$${tpnl.toFixed(2)}` : '—'; document.getElementById('JPNL').className = `jv ${tpnl>=0?'jp':'jn'}`;
  document.getElementById('JBST').textContent = t.length ? `$${best.toFixed(2)}` : '—';
  document.getElementById('JTB').innerHTML = t.map(x => `<tr><td>${x.date}</td><td style="font-weight:700">${x.sym}</td><td class="${x.dir==='LONG'?'up':'dn'}" style="font-weight:700">${x.dir}</td><td>${fp(x.en)}</td><td>${fp(x.ex)}</td><td class="${x.pu>=0?'jp':'jn'}">$${x.pu.toFixed(2)}</td><td class="${x.pp>=0?'jp':'jn'}">${x.pp.toFixed(2)}%</td><td>${x.mod}</td><td style="color:var(--tx2);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.nts||'—'}</td><td><button class="jdel" onclick="window.deleteTrade(${x.id})">✕</button></td></tr>`).join('');
}

// INITIAL BOOT
window.addEventListener('load', initAuth);
