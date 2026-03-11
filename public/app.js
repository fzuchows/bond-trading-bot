/* ── BOND TRADING BOT — FIELD OPERATIONS ── */

let ws;
let state = null;
let selectedSymbol = 'GLD';
let tradeAction = 'BUY';
let prevPrices = {};

// ── WebSocket connection ──────────────────────────────────────────────────────

function connect() {
  ws = new WebSocket(`ws://${location.host}`);

  ws.onopen = () => console.log('[007] Secure channel established.');

  ws.onmessage = (evt) => {
    const data = JSON.parse(evt.data);
    if (data.type === 'init' || data.type === 'update') {
      applyState(data);
    }
  };

  ws.onclose = () => {
    console.warn('[007] Connection lost. Reconnecting...');
    setTimeout(connect, 2000);
  };
}

function applyState(data) {
  const prev = state ? { ...state.prices } : {};
  state = data;

  renderClock();
  renderMissionStatus();
  renderPortfolio();
  renderBotControls();
  renderChart();
  renderHoldings(prev);
  renderTradeLog();
  populateSymbolSelect();
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function renderClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('en-GB', { hour12: false });
}
setInterval(renderClock, 1000);

// ── Mission Status ────────────────────────────────────────────────────────────

function renderMissionStatus() {
  if (!state) return;
  const el = document.getElementById('mission-status');
  el.textContent = state.missionStatus;
  el.className = 'mission-value ' + (state.botActive ? 'active' : 'standby');
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

function renderPortfolio() {
  if (!state) return;
  const p = state.portfolio;

  animateValue('total-value', p.totalValue, '$', 2);
  animateValue('cash-value', p.cash, '$', 2);

  const pnlEl  = document.getElementById('pnl-value');
  const pctEl  = document.getElementById('pnl-pct');
  const cls    = p.pnl > 0 ? 'positive' : p.pnl < 0 ? 'negative' : 'neutral';
  const sign   = p.pnl >= 0 ? '+' : '';

  pnlEl.textContent = `${sign}${fmt(p.pnl)}`;
  pnlEl.className   = `stat-value ${cls}`;

  pctEl.textContent = `${sign}${p.pnlPct.toFixed(2)}%`;
  pctEl.className   = `stat-value ${cls}`;
}

function animateValue(id, val, prefix = '', decimals = 2) {
  const el = document.getElementById(id);
  if (el) el.textContent = `${prefix}${fmt(val, decimals)}`;
}

function fmt(n, decimals = 2) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── Bot Controls ──────────────────────────────────────────────────────────────

function renderBotControls() {
  if (!state) return;
  document.getElementById('btn-start').disabled = state.botActive;
  document.getElementById('btn-stop').disabled  = !state.botActive;
  document.getElementById('tick-count').textContent  = state.tickCount;
  document.getElementById('trade-count').textContent = state.tradeHistory.length;
}

// ── Chart ─────────────────────────────────────────────────────────────────────

let chartInitialized = false;

function renderChart() {
  if (!state) return;

  if (!chartInitialized) {
    buildChartTabs();
    chartInitialized = true;
  }

  drawChart(selectedSymbol);
}

function buildChartTabs() {
  const wrap = document.getElementById('chart-tabs');
  wrap.innerHTML = '';
  state.assets.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (a.symbol === selectedSymbol ? ' active' : '');
    btn.textContent = a.symbol;
    btn.onclick = () => {
      selectedSymbol = a.symbol;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      drawChart(selectedSymbol);
    };
    wrap.appendChild(btn);
  });
}

function drawChart(symbol) {
  const canvas = document.getElementById('price-chart');
  const ctx    = canvas.getContext('2d');
  const dpr    = window.devicePixelRatio || 1;

  // Resize to actual pixel dimensions
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;

  ctx.clearRect(0, 0, W, H);

  const hist   = state.priceHistory[symbol] || [];
  const asset  = state.assets.find(a => a.symbol === symbol);
  const current = state.prices[symbol];
  const first   = hist[0] || current;
  const change  = ((current - first) / first) * 100;
  const isUp    = change >= 0;

  // Update info row
  document.getElementById('chart-asset-name').textContent  = asset ? asset.name : symbol;
  document.getElementById('chart-current-price').textContent = `$${fmt(current)}`;
  const chEl = document.getElementById('chart-change');
  chEl.textContent = `${isUp ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}%`;
  chEl.className   = `chart-change ${isUp ? 'positive' : 'negative'}`;

  if (hist.length < 2) return;

  const pad   = { top: 10, right: 10, bottom: 24, left: 52 };
  const cW    = W - pad.left - pad.right;
  const cH    = H - pad.top  - pad.bottom;

  const minP  = Math.min(...hist) * 0.998;
  const maxP  = Math.max(...hist) * 1.002;
  const range = maxP - minP || 1;

  const xOf = (i) => pad.left + (i / (hist.length - 1)) * cW;
  const yOf = (p) => pad.top  + (1 - (p - minP) / range) * cH;

  // Grid lines
  ctx.strokeStyle = '#1a2535';
  ctx.lineWidth   = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * cH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y);
    ctx.stroke();
    const val = maxP - (i / 4) * range;
    ctx.fillStyle = '#3a4a5a';
    ctx.font = '10px "Share Tech Mono"';
    ctx.textAlign = 'right';
    ctx.fillText(`$${fmt(val)}`, pad.left - 4, y + 3);
  }

  // Gradient fill
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
  if (isUp) {
    grad.addColorStop(0, 'rgba(61,220,132,0.3)');
    grad.addColorStop(1, 'rgba(61,220,132,0)');
  } else {
    grad.addColorStop(0, 'rgba(232,76,101,0.3)');
    grad.addColorStop(1, 'rgba(232,76,101,0)');
  }

  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(hist[0]));
  for (let i = 1; i < hist.length; i++) {
    ctx.lineTo(xOf(i), yOf(hist[i]));
  }
  ctx.lineTo(xOf(hist.length - 1), pad.top + cH);
  ctx.lineTo(xOf(0), pad.top + cH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(hist[0]));
  for (let i = 1; i < hist.length; i++) {
    ctx.lineTo(xOf(i), yOf(hist[i]));
  }
  ctx.strokeStyle = isUp ? '#3ddc84' : '#e84c65';
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  // Current price line
  const cy = yOf(current);
  ctx.beginPath(); ctx.moveTo(pad.left, cy); ctx.lineTo(pad.left + cW, cy);
  ctx.strokeStyle = isUp ? '#3ddc8460' : '#e84c6560';
  ctx.lineWidth   = 0.8;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Dot at latest
  const lx = xOf(hist.length - 1);
  const ly = yOf(hist[hist.length - 1]);
  ctx.beginPath();
  ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = isUp ? '#3ddc84' : '#e84c65';
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();

  // x-axis time labels
  ctx.fillStyle = '#3a4a5a';
  ctx.font = '9px "Share Tech Mono"';
  ctx.textAlign = 'center';
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const idx = Math.round((i / steps) * (hist.length - 1));
    ctx.fillText(`T-${hist.length - 1 - idx}`, xOf(idx), H - 6);
  }
}

// ── Holdings ──────────────────────────────────────────────────────────────────

function renderHoldings(prevPrices) {
  if (!state) return;
  const tbody = document.getElementById('holdings-body');
  tbody.innerHTML = '';

  state.assets.forEach(a => {
    const h    = state.portfolio.holdings[a.symbol];
    const price = state.prices[a.symbol];
    const prev  = prevPrices[a.symbol] || price;
    const value = h.qty * price;
    const pnl   = h.qty > 0 ? (price - h.avgCost) * h.qty : 0;
    const pnlPct = h.qty > 0 && h.avgCost > 0 ? ((price - h.avgCost) / h.avgCost) * 100 : 0;
    const chg   = ((price - prev) / prev) * 100;
    const up    = price >= prev;

    const tr = document.createElement('tr');
    if (price !== prev) {
      tr.classList.add(up ? 'flash-green' : 'flash-red');
    }

    tr.innerHTML = `
      <td>
        <span class="td-symbol">${a.symbol}</span>
        <span class="td-name">${a.name}</span>
      </td>
      <td class="${up ? 'td-pos' : 'td-neg'}">$${fmt(price)}</td>
      <td class="${chg >= 0 ? 'td-pos' : 'td-neg'}">${chg >= 0 ? '▲' : '▼'}${Math.abs(chg).toFixed(2)}%</td>
      <td class="${h.qty > 0 ? 'td-hold' : 'td-dim'}">${h.qty}</td>
      <td class="td-dim">${h.qty > 0 ? '$' + fmt(h.avgCost) : '—'}</td>
      <td class="${h.qty > 0 ? '' : 'td-dim'}">${h.qty > 0 ? '$' + fmt(value) : '—'}</td>
      <td class="${pnl > 0 ? 'td-pos' : pnl < 0 ? 'td-neg' : 'td-dim'}">
        ${h.qty > 0 ? (pnl >= 0 ? '+' : '') + '$' + fmt(pnl) + ' (' + (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) + '%)' : '—'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Trade Log ─────────────────────────────────────────────────────────────────

let lastLogId = null;

function renderTradeLog() {
  if (!state) return;
  const container = document.getElementById('trade-log');
  const trades    = state.tradeHistory;

  if (trades.length === 0) {
    container.innerHTML = '<div class="log-empty">AWAITING ORDERS...</div>';
    return;
  }

  if (trades[0]?.id === lastLogId) return;
  lastLogId = trades[0]?.id;

  container.innerHTML = trades.map(t => `
    <div class="log-entry ${t.action.toLowerCase()}">
      <div class="log-time">${t.time}</div>
      <div class="log-main">
        <span class="log-action">${t.action}</span>
        <span class="log-symbol">${t.symbol}</span>
        <span class="log-qty">× ${t.qty}</span>
        <span class="log-price">@ $${t.price}</span>
      </div>
      <div class="log-reason">${t.reason}</div>
    </div>
  `).join('');
}

// ── Symbol Select ─────────────────────────────────────────────────────────────

function populateSymbolSelect() {
  if (!state || !state.assets) return;
  const sel = document.getElementById('trade-symbol');
  if (sel.options.length > 1) return;
  state.assets.forEach(a => {
    const opt = new Option(`${a.symbol} — ${a.name}`, a.symbol);
    sel.add(opt);
  });
  sel.value = selectedSymbol;
}

// ── Trade Form ────────────────────────────────────────────────────────────────

function setAction(action) {
  tradeAction = action;
  document.getElementById('action-buy').classList.toggle('active',  action === 'BUY');
  document.getElementById('action-sell').classList.toggle('active', action === 'SELL');
}

async function submitTrade() {
  const symbol = document.getElementById('trade-symbol').value;
  const qty    = parseInt(document.getElementById('trade-qty').value);
  const msg    = document.getElementById('trade-msg');

  if (!symbol || !qty || qty <= 0) {
    showMsg(msg, 'INVALID ORDER PARAMETERS', false);
    return;
  }

  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, action: tradeAction, qty }),
    });
    const data = await res.json();
    if (data.ok) {
      showMsg(msg, `ORDER CONFIRMED — ${tradeAction} ${qty} ${symbol}`, true);
    } else {
      showMsg(msg, 'ORDER REJECTED — INSUFFICIENT FUNDS', false);
    }
  } catch (e) {
    showMsg(msg, 'TRANSMISSION FAILURE', false);
  }
}

function showMsg(el, text, ok) {
  el.textContent = text;
  el.className   = `trade-msg ${ok ? 'ok' : 'err'}`;
  setTimeout(() => { el.textContent = ''; el.className = 'trade-msg'; }, 3000);
}

// ── Bot Controls ──────────────────────────────────────────────────────────────

async function startBot() {
  await fetch('/api/bot/start', { method: 'POST' });
}

async function stopBot() {
  await fetch('/api/bot/stop', { method: 'POST' });
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  if (state) drawChart(selectedSymbol);
});

connect();
