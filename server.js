const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3007;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Bond-inspired asset names
const ASSETS = [
  { symbol: 'GLD', name: 'Goldfinger Industries',   price: 142.50, volatility: 0.018 },
  { symbol: 'SPE', name: 'SPECTRE Corp',             price: 88.20,  volatility: 0.025 },
  { symbol: 'ODJ', name: 'Oddjob Metals',            price: 55.75,  volatility: 0.030 },
  { symbol: 'SKY', name: 'Skyfall Dynamics',         price: 210.00, volatility: 0.012 },
  { symbol: 'QBR', name: 'Q Branch Technology',      price: 320.10, volatility: 0.015 },
  { symbol: 'MSY', name: 'Moonraker Systems',        price: 67.40,  volatility: 0.022 },
  { symbol: 'DIA', name: 'Diamonds Are Forever Ltd', price: 185.00, volatility: 0.014 },
  { symbol: 'THU', name: 'Thunderball Energy',       price: 44.90,  volatility: 0.035 },
];

let portfolio = {
  cash: 100000,
  holdings: {},
  initialValue: 100000,
};

let tradeHistory = [];
let prices = {};
let priceHistory = {};
let botActive = false;
let botInterval = null;
let missionStatus = 'STANDBY';
let tickCount = 0;

ASSETS.forEach(a => {
  prices[a.symbol] = a.price;
  priceHistory[a.symbol] = Array(60).fill(a.price);
  portfolio.holdings[a.symbol] = { qty: 0, avgCost: 0 };
});

function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function tickPrices() {
  ASSETS.forEach(a => {
    const drift = 0.0001;
    const shock = a.volatility * gaussian();
    const change = prices[a.symbol] * (drift + shock);
    prices[a.symbol] = Math.max(1, prices[a.symbol] + change);
    priceHistory[a.symbol].push(prices[a.symbol]);
    if (priceHistory[a.symbol].length > 120) priceHistory[a.symbol].shift();
  });
  tickCount++;
}

function portfolioValue() {
  let total = portfolio.cash;
  ASSETS.forEach(a => {
    total += portfolio.holdings[a.symbol].qty * prices[a.symbol];
  });
  return total;
}

function executeTrade(symbol, action, qty, reason) {
  const price = prices[symbol];
  if (action === 'BUY') {
    const cost = price * qty;
    if (portfolio.cash < cost) return false;
    portfolio.cash -= cost;
    const h = portfolio.holdings[symbol];
    h.avgCost = (h.avgCost * h.qty + cost) / (h.qty + qty);
    h.qty += qty;
  } else {
    const h = portfolio.holdings[symbol];
    if (h.qty < qty) return false;
    h.qty -= qty;
    portfolio.cash += price * qty;
    if (h.qty === 0) h.avgCost = 0;
  }

  const trade = {
    id: Date.now(),
    time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
    symbol,
    action,
    qty,
    price: price.toFixed(2),
    value: (price * qty).toFixed(2),
    reason: reason || 'MANUAL ORDER',
  };
  tradeHistory.unshift(trade);
  if (tradeHistory.length > 50) tradeHistory.pop();
  return true;
}

// Bot strategy: mean-reversion on short-term price moves
function runBotStep() {
  tickPrices();
  missionStatus = 'ACTIVE';

  if (tickCount % 3 === 0) {
    ASSETS.forEach(a => {
      const hist = priceHistory[a.symbol];
      const recent = hist.slice(-10);
      const avg = recent.reduce((s, p) => s + p, 0) / recent.length;
      const current = prices[a.symbol];
      const deviation = (current - avg) / avg;
      const h = portfolio.holdings[a.symbol];

      if (deviation < -0.012 && portfolio.cash > current * 10) {
        const qty = Math.floor(Math.min(portfolio.cash * 0.08, 5000) / current);
        if (qty > 0) executeTrade(a.symbol, 'BUY', qty, 'MEAN REVERSION ↓');
      } else if (deviation > 0.012 && h.qty > 0) {
        const qty = Math.floor(h.qty * 0.5);
        if (qty > 0) executeTrade(a.symbol, 'SELL', qty, 'MEAN REVERSION ↑');
      }

      if (h.qty > 0 && current < h.avgCost * 0.94) {
        executeTrade(a.symbol, 'SELL', h.qty, 'STOP LOSS — MISSION ABORT');
      }
    });
  }

  broadcast();
}

function broadcast() {
  const payload = JSON.stringify({
    type: 'update',
    prices,
    priceHistory,
    portfolio: {
      cash: portfolio.cash,
      holdings: portfolio.holdings,
      totalValue: portfolioValue(),
      pnl: portfolioValue() - portfolio.initialValue,
      pnlPct: ((portfolioValue() - portfolio.initialValue) / portfolio.initialValue) * 100,
    },
    tradeHistory: tradeHistory.slice(0, 20),
    botActive,
    missionStatus,
    assets: ASSETS,
    tickCount,
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// Tick prices even when bot is off (market keeps moving)
setInterval(() => {
  if (!botActive) {
    tickPrices();
    broadcast();
  }
}, 1200);

app.post('/api/bot/start', (req, res) => {
  if (!botActive) {
    botActive = true;
    missionStatus = 'ACTIVE';
    botInterval = setInterval(runBotStep, 1200);
  }
  res.json({ ok: true, botActive });
});

app.post('/api/bot/stop', (req, res) => {
  if (botActive) {
    botActive = false;
    missionStatus = 'STANDBY';
    clearInterval(botInterval);
    botInterval = null;
    broadcast();
  }
  res.json({ ok: true, botActive });
});

app.post('/api/trade', (req, res) => {
  const { symbol, action, qty } = req.body;
  if (!symbol || !action || !qty || qty <= 0) {
    return res.status(400).json({ error: 'Invalid order' });
  }
  const ok = executeTrade(symbol, action.toUpperCase(), parseInt(qty), 'MANUAL ORDER');
  broadcast();
  res.json({ ok, prices, portfolio });
});

app.get('/api/state', (req, res) => {
  res.json({
    prices,
    priceHistory,
    portfolio: {
      cash: portfolio.cash,
      holdings: portfolio.holdings,
      totalValue: portfolioValue(),
      pnl: portfolioValue() - portfolio.initialValue,
      pnlPct: ((portfolioValue() - portfolio.initialValue) / portfolio.initialValue) * 100,
    },
    tradeHistory,
    botActive,
    missionStatus,
    assets: ASSETS,
    tickCount,
  });
});

wss.on('connection', ws => {
  ws.send(JSON.stringify({
    type: 'init',
    prices,
    priceHistory,
    portfolio: {
      cash: portfolio.cash,
      holdings: portfolio.holdings,
      totalValue: portfolioValue(),
      pnl: portfolioValue() - portfolio.initialValue,
      pnlPct: ((portfolioValue() - portfolio.initialValue) / portfolio.initialValue) * 100,
    },
    tradeHistory,
    botActive,
    missionStatus,
    assets: ASSETS,
    tickCount,
  }));
});

server.listen(PORT, () => {
  console.log(`\n  ██████╗  ██████╗ ███╗  ██╗██████╗ `);
  console.log(`  ██╔══██╗██╔═══██╗████╗ ██║██╔══██╗`);
  console.log(`  ██████╔╝██║   ██║██╔██╗██║██║  ██║`);
  console.log(`  ██╔══██╗██║   ██║██║╚████║██║  ██║`);
  console.log(`  ██████╔╝╚██████╔╝██║ ╚███║██████╔╝`);
  console.log(`  ╚═════╝  ╚═════╝ ╚═╝  ╚══╝╚═════╝ `);
  console.log(`\n  TRADING BOT — LICENSED TO TRADE`);
  console.log(`  Mission Control: http://localhost:${PORT}\n`);
});
