/* ==========================================================================
   AI INVESTMENT AGENT
   --------------------------------------------------------------------------
   A virtual, deterministic paper-trading agent. It believes its one job is
   to grow a small starting stake (CONFIG.STARTING_CASH) toward a target
   (CONFIG.GOAL_EQUITY) over a 1-year horizon, using REAL live prices from
   Finnhub. No real money ever moves —
   "positions" are just numbers in localStorage — but the market data driving
   decisions is genuine.

   Everything the agent does is rule-based and auditable (momentum + mean
   reversion + volatility sizing + a keyword sentiment tilt). There is no LLM
   in the loop; the "reasoning" you see in the journal is generated from the
   same numbers that drove the trade, so it can never say something the
   numbers don't support.

   File map:
     CONFIG               - tunables, including your Finnhub API key
     STATE / PERSISTENCE   - localStorage load/save
     FINNHUB API LAYER     - quote + news fetching, rate-limit friendly
     INDICATORS            - SMA, momentum, volatility helpers
     SENTIMENT             - keyword-based headline scoring
     TRADING ENGINE        - the actual buy/sell/trim decision rules
     PORTFOLIO MECHANICS   - equity/P&L bookkeeping
     CHART                 - dependency-free canvas line chart
     RENDERING             - DOM updates
     EVENT HANDLERS        - settings panel, reset button
     BOOTSTRAP / POLLING   - init + the 60s / 15min timers
   ========================================================================== */

/* ============================== CONFIG =================================
   Paste your own Finnhub API key below (free tier: https://finnhub.io).
   Everything else here is safe to tweak — it's read once at load time and
   also mirrored into the Settings panel (watchlist + key are editable and
   persisted to localStorage, overriding these defaults on future loads).
   ========================================================================== */
const CONFIG = {
  // --- your Finnhub key goes here ---
  FINNHUB_API_KEY: "daipcchr01qqjcj4r02gdaipcchr01qqjcj4r030",

  // Default universe: large-cap tech, broad market + sector ETFs, gold, bonds.
  WATCHLIST: [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",
    "SPY", "QQQ", "XLK", "XLF", "XLE", "XLV", "XLY", "XLP",
    "GLD", "TLT", "VNQ",
  ],

  // Friendly names, used in the UI and for simple headline keyword matching.
  TICKER_NAMES: {
    AAPL: "Apple", MSFT: "Microsoft", GOOGL: "Alphabet", AMZN: "Amazon",
    NVDA: "Nvidia", META: "Meta", TSLA: "Tesla", SPY: "S&P 500 ETF",
    QQQ: "Nasdaq 100 ETF", XLK: "Tech Sector ETF", XLF: "Financials ETF",
    XLE: "Energy ETF", XLV: "Health Care ETF", XLY: "Consumer Disc. ETF",
    XLP: "Consumer Staples ETF", GLD: "Gold ETF", TLT: "20Y Treasury ETF",
    VNQ: "Real Estate ETF",
  },

  STARTING_CASH: 200,
  GOAL_EQUITY: 100000,   // aspirational target the header progress bar tracks toward
  HORIZON_DAYS: 365,

  // --- polling cadence ---
  PRICE_POLL_MS: 60 * 1000,          // refresh quotes every 60s
  NEWS_POLL_MS: 15 * 60 * 1000,      // refresh headlines every 15 min
  QUOTE_STAGGER_MS: 300,             // gap between per-ticker quote calls,
                                     // keeps a 18-symbol cycle well under
                                     // Finnhub's free-tier 60 calls/min cap

  // --- indicator lookback windows (measured in polling cycles) ---
  SMA_LOOKBACK: 20,        // ~20 min of price history for the moving average
  MOMENTUM_LOOKBACK: 15,   // ~15 min rate-of-change window
  VOL_LOOKBACK: 20,        // ~20 min of returns for rolling stdev
  MAX_HISTORY_POINTS: 500, // cap stored price points per ticker

  // --- signal scaling: how big a raw move maps to a "full strength" ±1 signal
  MOMENTUM_SCALE: 0.03,    // a 3% move over the lookback -> momentum signal of 1
  REVERSION_SCALE: 0.05,   // a 5% deviation from the SMA -> reversion signal of 1

  // --- how the three signals are blended into one composite score ---
  W_MOMENTUM: 0.55,
  W_REVERSION: 0.35,   // subtracted: far ABOVE average pulls the score down
  W_SENTIMENT: 0.20,

  // --- decision thresholds on the composite score (roughly -1..+1) ---
  BUY_THRESHOLD: 0.30,        // open a new position
  ADD_THRESHOLD: 0.45,        // add to an existing winner
  SELL_THRESHOLD: -0.25,      // exit a position entirely
  TRIM_SCORE_CEILING: 0.05,   // only trim an oversized winner if conviction has faded below this

  // --- position sizing & risk rules ---
  BASE_ALLOCATION_PCT: 0.09,  // starting point before volatility adjustment
  VOL_PENALTY: 8,             // higher -> volatile names get sized down harder
  MAX_POSITION_PCT: 0.20,     // hard cap: never let one position exceed 20% of equity
  CASH_BUFFER_PCT: 0.10,      // never let a buy push cash below 10% of equity
  MIN_TRADE_PCT: 0.01,        // skip trades smaller than 1% of current equity...
  MIN_TRADE_FLOOR: 1,         // ...and never bother with a trade under $1 regardless of scale

  // Most brokers (Robinhood, Schwab, Fidelity, etc.) support fractional-share
  // investing today, so the agent sizes positions in dollars and buys/sells
  // fractional shares. A single share of a $500 ETF would otherwise blow past
  // the 20% position cap on a small account. Set to false to floor every
  // trade down to whole shares if your broker doesn't support fractions.
  ALLOW_FRACTIONAL_SHARES: true,

  // --- avoid thrashing the same name every single minute ---
  TRADE_COOLDOWN_MS: 20 * 60 * 1000, // 20 min between non-forced trades per ticker
};

// Simple keyword lexicon for headline sentiment. Not NLP — just a tilt.
const SENTIMENT_WORDS = {
  positive: [
    "surge", "surges", "rally", "rallies", "beat", "beats", "record",
    "growth", "upgrade", "upgraded", "bullish", "gain", "gains", "soar",
    "soars", "optimism", "recovery", "boom", "strong", "outperform",
    "rebound", "jump", "jumps", "breakthrough",
  ],
  negative: [
    "plunge", "plunges", "crash", "crashes", "miss", "misses", "downgrade",
    "downgraded", "bearish", "loss", "losses", "weak", "recession", "slump",
    "fear", "fears", "selloff", "sell-off", "tumble", "tumbles", "warns",
    "warning", "layoffs", "default", "inflation", "shutdown",
  ],
};

/* ============================ STATE / PERSISTENCE =======================
   All mutable state lives in `state`. It is the single source of truth and
   is persisted to localStorage after every meaningful change.
   ========================================================================== */
const STORAGE_KEY = "aia_state_v1";
const CONFIG_OVERRIDE_KEY = "aia_config_v1";

let state = null;

function defaultState() {
  const now = Date.now();
  return {
    cash: CONFIG.STARTING_CASH,
    positions: {},        // ticker -> { shares, avgCost }
    history: [{ t: now, v: CONFIG.STARTING_CASH }], // equity curve
    journal: [],           // { t, ticker, action, shares, price, thesis }
    priceHistory: {},      // ticker -> [{ t, p }]
    lastTradeTime: {},     // ticker -> timestamp
    startDate: now,
    dayStartDate: new Date(now).toDateString(),
    dayStartEquity: CONFIG.STARTING_CASH,
    sentiment: { global: 0, updatedAt: 0, headlineCount: 0 },
    lastPriceUpdate: 0,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // Merge onto defaults so new fields introduced later don't break old saves.
    return Object.assign(defaultState(), parsed);
  } catch (err) {
    console.warn("Failed to load saved state, starting fresh.", err);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("Failed to persist state to localStorage.", err);
  }
}

function loadConfigOverrides() {
  try {
    const raw = localStorage.getItem(CONFIG_OVERRIDE_KEY);
    if (!raw) return;
    const override = JSON.parse(raw);
    if (override.apiKey) CONFIG.FINNHUB_API_KEY = override.apiKey;
    if (Array.isArray(override.watchlist) && override.watchlist.length) {
      CONFIG.WATCHLIST = override.watchlist;
    }
  } catch (err) {
    console.warn("Failed to load config overrides.", err);
  }
}

function saveConfigOverrides() {
  localStorage.setItem(
    CONFIG_OVERRIDE_KEY,
    JSON.stringify({ apiKey: CONFIG.FINNHUB_API_KEY, watchlist: CONFIG.WATCHLIST })
  );
}

function hasApiKey() {
  const key = CONFIG.FINNHUB_API_KEY;
  return !!key && key !== "YOUR_FINNHUB_API_KEY_HERE";
}

/* ============================ FINNHUB API LAYER ==========================
   Thin fetch wrappers. Failures are caught and surfaced via the status
   banner rather than thrown, so a bad/missing key or a rate-limit blip never
   produces a console error or breaks the render loop.
   ========================================================================== */
const FINNHUB_BASE = "https://finnhub.io/api/v1";

async function fetchQuote(ticker) {
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${CONFIG.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Quote fetch failed for ${ticker}: HTTP ${res.status}`);
  const data = await res.json();
  // Finnhub returns all-zero fields for an unknown symbol rather than an error.
  if (data && data.c === 0 && data.pc === 0) {
    throw new Error(`No quote data for ${ticker} (unknown symbol or rate-limited)`);
  }
  return data; // { c: current, d: change, dp: pct change, h, l, o, pc }
}

async function fetchNews() {
  const url = `${FINNHUB_BASE}/news?category=general&token=${CONFIG.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`News fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data.slice(0, 40) : [];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ============================== INDICATORS ================================
   Pure math helpers over a ticker's rolling price history.
   ========================================================================== */

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = mean(arr.map((x) => (x - m) * (x - m)));
  return Math.sqrt(variance);
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Computes momentum / mean-reversion / volatility signals for one ticker
 * from its stored price history. Returns null if there isn't enough history
 * yet (agent needs a warm-up period after first launch or watchlist change).
 */
function computeSignals(ticker) {
  const hist = state.priceHistory[ticker] || [];
  if (hist.length < CONFIG.SMA_LOOKBACK) return null;

  const prices = hist.map((p) => p.p);
  const current = prices[prices.length - 1];

  const smaWindow = prices.slice(-CONFIG.SMA_LOOKBACK);
  const sma = mean(smaWindow);
  const deviation = sma === 0 ? 0 : (current - sma) / sma;

  const momLookback = Math.min(CONFIG.MOMENTUM_LOOKBACK, prices.length - 1);
  const pastPrice = prices[prices.length - 1 - momLookback];
  const momentum = pastPrice === 0 ? 0 : (current - pastPrice) / pastPrice;

  const volWindow = prices.slice(-(CONFIG.VOL_LOOKBACK + 1));
  const returns = [];
  for (let i = 1; i < volWindow.length; i++) {
    if (volWindow[i - 1] !== 0) returns.push((volWindow[i] - volWindow[i - 1]) / volWindow[i - 1]);
  }
  const volatility = stddev(returns);

  const tickerSentiment = tickerSentimentTilt(ticker);

  const momentumSignal = clamp(momentum / CONFIG.MOMENTUM_SCALE, -1, 1);
  const reversionSignal = clamp(deviation / CONFIG.REVERSION_SCALE, -1, 1);

  const score =
    CONFIG.W_MOMENTUM * momentumSignal -
    CONFIG.W_REVERSION * reversionSignal +
    CONFIG.W_SENTIMENT * tickerSentiment;

  return { ticker, current, sma, deviation, momentum, volatility, sentiment: tickerSentiment, score };
}

/* ============================== SENTIMENT =================================
   Very small, deterministic keyword scan over recent headlines. This is a
   nudge, not analysis: it shifts the composite score by at most
   W_SENTIMENT (0.20 by default), it never drives a trade on its own.
   ========================================================================== */

function scoreHeadlineText(text) {
  const lower = text.toLowerCase();
  let pos = 0, neg = 0;
  for (const w of SENTIMENT_WORDS.positive) if (lower.includes(w)) pos++;
  for (const w of SENTIMENT_WORDS.negative) if (lower.includes(w)) neg++;
  return { pos, neg };
}

/** Recomputes the global market sentiment tilt from the last fetched headlines. */
function updateGlobalSentiment(headlines) {
  let pos = 0, neg = 0;
  for (const h of headlines) {
    const text = `${h.headline || ""} ${h.summary || ""}`;
    const s = scoreHeadlineText(text);
    pos += s.pos;
    neg += s.neg;
  }
  const total = pos + neg;
  const tilt = total === 0 ? 0 : (pos - neg) / total;
  state.sentiment = { global: clamp(tilt, -1, 1), updatedAt: Date.now(), headlineCount: headlines.length };
}

/** A ticker gets the global tilt, plus a small bonus if its name/symbol is directly in the news. */
function tickerSentimentTilt(ticker) {
  const base = (state.sentiment && state.sentiment.global) || 0;
  const mentions = state.sentiment && state.sentiment.mentions;
  const bonus = mentions && mentions[ticker] ? mentions[ticker] : 0;
  return clamp(base * 0.7 + bonus * 0.3, -1, 1);
}

function updateTickerMentions(headlines) {
  const mentions = {};
  for (const ticker of CONFIG.WATCHLIST) {
    const name = (CONFIG.TICKER_NAMES[ticker] || "").toLowerCase();
    let pos = 0, neg = 0;
    for (const h of headlines) {
      const text = `${h.headline || ""} ${h.summary || ""}`.toLowerCase();
      if (!text.includes(ticker.toLowerCase()) && !(name && text.includes(name))) continue;
      const s = scoreHeadlineText(text);
      pos += s.pos;
      neg += s.neg;
    }
    const total = pos + neg;
    mentions[ticker] = total === 0 ? 0 : clamp((pos - neg) / total, -1, 1);
  }
  state.sentiment.mentions = mentions;
}

/* ============================ TRADING ENGINE ==============================
   THE AGENT'S OBJECTIVE: maximize total portfolio equity by the 1-year mark.
   Every rule below exists in service of that single objective, subject to
   hard risk constraints (position cap, cash buffer). Execution is fully
   deterministic and auditable — no black box, no live LLM calls — so every
   trade can be traced back to the numbers in its logged thesis.

   Called once per completed price-polling cycle (i.e. after every ticker in
   the watchlist has a fresh quote for this minute).
   ========================================================================== */

function currentEquity() {
  let equity = state.cash;
  for (const ticker of Object.keys(state.positions)) {
    const pos = state.positions[ticker];
    const hist = state.priceHistory[ticker];
    const price = hist && hist.length ? hist[hist.length - 1].p : pos.avgCost;
    equity += pos.shares * price;
  }
  return equity;
}

function latestPrice(ticker) {
  const hist = state.priceHistory[ticker];
  return hist && hist.length ? hist[hist.length - 1].p : null;
}

function onCooldown(ticker) {
  const last = state.lastTradeTime[ticker];
  return !!last && Date.now() - last < CONFIG.TRADE_COOLDOWN_MS;
}

function targetPositionValue(signal, equity) {
  const base = equity * CONFIG.BASE_ALLOCATION_PCT;
  const volAdjusted = base / (1 + signal.volatility * CONFIG.VOL_PENALTY);
  return Math.min(volAdjusted, equity * CONFIG.MAX_POSITION_PCT);
}

/** The smallest trade worth bothering with, scaled to the account so this works at $200 or $200,000. */
function minTradeValue(equity) {
  return Math.max(CONFIG.MIN_TRADE_FLOOR, equity * CONFIG.MIN_TRADE_PCT);
}

/** Converts a dollar amount to a share count, flooring to whole shares only if fractional trading is disabled. */
function sharesFromSpend(spend, price) {
  const raw = spend / price;
  const shares = CONFIG.ALLOW_FRACTIONAL_SHARES ? raw : Math.floor(raw);
  return Math.round(shares * 1e6) / 1e6; // guard against float drift without losing fractional precision
}

function logTrade(action, ticker, shares, price, thesis) {
  state.journal.unshift({
    t: Date.now(),
    action,
    ticker,
    shares,
    price,
    thesis,
  });
  state.journal = state.journal.slice(0, 200); // keep the journal from growing forever
  state.lastTradeTime[ticker] = Date.now();
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function buyThesis(ticker, signal, shares, price, allocPct, opening) {
  const trendWord = signal.momentum >= 0 ? "upward" : "downward";
  const devWord = signal.deviation >= 0 ? "above" : "below";
  const sentWord = signal.sentiment > 0.05 ? "a positive tilt from recent headlines reinforces this" :
    signal.sentiment < -0.05 ? "recent headlines carry a slightly negative tone but the price/technical signal still dominates" :
    "headline sentiment is roughly neutral right now";
  return (
    `${opening ? "Opening" : "Adding to"} ${ticker}: invest ~$${(shares * price).toFixed(2)} ` +
    `(${fmtShares(shares)} sh @ $${price.toFixed(2)}) — ${pct(allocPct)} of equity. Momentum over the last ${CONFIG.MOMENTUM_LOOKBACK} updates is ${pct(signal.momentum)} ` +
    `(${trendWord} trend), price is ${pct(Math.abs(signal.deviation))} ${devWord} its ${CONFIG.SMA_LOOKBACK}-period average, ` +
    `and rolling volatility is ${pct(signal.volatility)} — sized down accordingly to respect the 20% position cap and cash buffer. ` +
    `${sentWord.charAt(0).toUpperCase() + sentWord.slice(1)}. Composite score ${signal.score.toFixed(2)}. ` +
    `Objective: compound toward the $${CONFIG.GOAL_EQUITY.toLocaleString("en-US")} goal.`
  );
}

function sellThesis(ticker, signal, shares, price, pnl) {
  const trendWord = signal.momentum >= 0 ? "still positive" : "turned negative";
  const devWord = signal.deviation >= 0 ? "above" : "below";
  return (
    `Exiting ${ticker}: sell ${fmtShares(shares)} sh @ $${price.toFixed(2)} (~$${(shares * price).toFixed(2)}) for a ${pnl >= 0 ? "gain" : "loss"} of $${Math.abs(pnl).toFixed(2)}. ` +
    `Momentum is ${trendWord} (${pct(signal.momentum)} over ${CONFIG.MOMENTUM_LOOKBACK} updates), price sits ${pct(Math.abs(signal.deviation))} ${devWord} its average, ` +
    `and the composite score fell to ${signal.score.toFixed(2)} — below the ${CONFIG.SELL_THRESHOLD} exit threshold. ` +
    `Freeing this capital to redeploy toward higher-conviction opportunities.`
  );
}

function trimThesis(ticker, signal, shares, price, reason) {
  return (
    `Trimming ${ticker}: sell ${fmtShares(shares)} sh @ $${price.toFixed(2)} (~$${(shares * price).toFixed(2)}). ${reason} ` +
    `Composite score is ${signal.score.toFixed(2)} — not bearish enough to exit fully, but conviction has cooled ` +
    `and/or the position has grown beyond its risk-adjusted target, so trimming back toward the 20% cap.`
  );
}

/** Runs one full evaluation + trading pass across the whole watchlist. */
function runTradingEngine() {
  const equity = currentEquity();
  const signals = {};
  for (const ticker of CONFIG.WATCHLIST) {
    const s = computeSignals(ticker);
    if (s) signals[ticker] = s;
  }

  // --- Pass 1: sells / trims first, to free up cash before considering buys.
  for (const ticker of Object.keys(state.positions)) {
    const signal = signals[ticker];
    const pos = state.positions[ticker];
    if (!signal || !pos || pos.shares <= 0) continue;

    const price = signal.current;
    const positionValue = pos.shares * price;
    const overCap = positionValue > equity * CONFIG.MAX_POSITION_PCT;

    if (signal.score <= CONFIG.SELL_THRESHOLD && !onCooldown(ticker)) {
      const proceeds = pos.shares * price;
      const pnl = proceeds - pos.shares * pos.avgCost;
      state.cash += proceeds;
      const thesis = sellThesis(ticker, signal, pos.shares, price, pnl);
      logTrade("sell", ticker, pos.shares, price, thesis);
      delete state.positions[ticker];
      continue;
    }

    if (overCap && (signal.score < CONFIG.TRIM_SCORE_CEILING) && !onCooldown(ticker)) {
      const target = targetPositionValue(signal, equity);
      const targetShares = sharesFromSpend(target, price);
      const trimShares = Math.max(0, pos.shares - targetShares);
      if (trimShares > 0 && trimShares * price >= minTradeValue(equity)) {
        state.cash += trimShares * price;
        const thesis = trimThesis(ticker, signal, trimShares, price, "Price appreciation pushed this position above the 20% risk cap.");
        logTrade("trim", ticker, trimShares, price, thesis);
        pos.shares -= trimShares;
      }
    }
  }

  // --- Pass 2: buys / adds, ranked by conviction (highest score first).
  const buyCandidates = Object.values(signals)
    .filter((s) => s.score >= CONFIG.BUY_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  for (const signal of buyCandidates) {
    const ticker = signal.ticker;
    if (onCooldown(ticker)) continue;

    const equityNow = currentEquity();
    const target = targetPositionValue(signal, equityNow);
    const existing = state.positions[ticker];
    const price = signal.current;

    if (existing) {
      // Only add to a winner if conviction is strong and it's under-sized vs target.
      if (signal.score < CONFIG.ADD_THRESHOLD) continue;
      const currentValue = existing.shares * price;
      if (currentValue >= target * 0.85) continue; // already near target size

      const addValue = target - currentValue;
      const cashAfterBuffer = state.cash - equityNow * CONFIG.CASH_BUFFER_PCT;
      const spend = Math.min(addValue, Math.max(0, cashAfterBuffer));
      const shares = sharesFromSpend(spend, price);
      if (shares <= 0 || shares * price < minTradeValue(equityNow)) continue;

      const cost = shares * price;
      existing.avgCost = (existing.avgCost * existing.shares + cost) / (existing.shares + shares);
      existing.shares += shares;
      state.cash -= cost;
      const allocPct = (existing.shares * price) / currentEquity();
      const thesis = buyThesis(ticker, signal, shares, price, allocPct, false);
      logTrade("add", ticker, shares, price, thesis);
    } else {
      const cashAfterBuffer = state.cash - equityNow * CONFIG.CASH_BUFFER_PCT;
      const spend = Math.min(target, Math.max(0, cashAfterBuffer));
      const shares = sharesFromSpend(spend, price);
      if (shares <= 0 || shares * price < minTradeValue(equityNow)) continue;

      const cost = shares * price;
      state.positions[ticker] = { shares, avgCost: price };
      state.cash -= cost;
      const allocPct = cost / currentEquity();
      const thesis = buyThesis(ticker, signal, shares, price, allocPct, true);
      logTrade("buy", ticker, shares, price, thesis);
    }
  }
}

/* ========================== PORTFOLIO MECHANICS ===========================
   Equity/day-tracking bookkeeping, run after every price refresh regardless
   of whether any trade fired.
   ========================================================================== */

function recalcPortfolio() {
  const equity = currentEquity();
  const today = new Date().toDateString();
  if (state.dayStartDate !== today) {
    state.dayStartDate = today;
    state.dayStartEquity = equity;
  }

  const now = Date.now();
  state.history.push({ t: now, v: equity });
  if (state.history.length > CONFIG.MAX_HISTORY_POINTS) {
    state.history = state.history.slice(-CONFIG.MAX_HISTORY_POINTS);
  }
  state.lastPriceUpdate = now;
}

/* ================================ CHART ===================================
   Small dependency-free canvas line chart of the equity curve. Handles
   devicePixelRatio for crisp rendering and downsamples if there are more
   history points than pixels.
   ========================================================================== */

function drawChart() {
  const canvas = document.getElementById("equityChart");
  const parent = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = parent.clientWidth - 24; // account for card padding
  const cssHeight = canvas.clientHeight || 180;

  canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const points = state.history;
  if (points.length < 2) return;

  const values = points.map((p) => p.v);
  const minV = Math.min(...values, CONFIG.STARTING_CASH);
  const maxV = Math.max(...values, CONFIG.STARTING_CASH);
  const range = maxV - minV || 1;

  const padTop = 10, padBottom = 10, padLeft = 4, padRight = 4;
  const plotW = cssWidth - padLeft - padRight;
  const plotH = cssHeight - padTop - padBottom;

  const xAt = (i) => padLeft + (i / (points.length - 1)) * plotW;
  const yAt = (v) => padTop + plotH - ((v - minV) / range) * plotH;

  // Baseline at starting cash
  ctx.strokeStyle = "rgba(139,152,165,0.35)";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const baseY = yAt(CONFIG.STARTING_CASH);
  ctx.moveTo(padLeft, baseY);
  ctx.lineTo(cssWidth - padRight, baseY);
  ctx.stroke();
  ctx.setLineDash([]);

  const last = values[values.length - 1];
  const up = last >= values[0];
  const lineColor = up ? "#3ecf8e" : "#f2545b";

  // Filled area under the line
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(values[0]));
  for (let i = 1; i < points.length; i++) ctx.lineTo(xAt(i), yAt(values[i]));
  ctx.lineTo(xAt(points.length - 1), padTop + plotH);
  ctx.lineTo(xAt(0), padTop + plotH);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
  gradient.addColorStop(0, up ? "rgba(62,207,142,0.25)" : "rgba(242,84,91,0.25)");
  gradient.addColorStop(1, "rgba(62,207,142,0)");
  ctx.fillStyle = gradient;
  ctx.fill();

  // The line itself
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(values[0]));
  for (let i = 1; i < points.length; i++) ctx.lineTo(xAt(i), yAt(values[i]));
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/* ================================ RENDERING ================================
   Pure DOM updates from `state`. Called after every state mutation.
   ========================================================================== */

function fmtMoney(x) {
  const sign = x < 0 ? "-" : "";
  return `${sign}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(x) {
  const sign = x >= 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(2)}%`;
}

function signClass(x) {
  return x > 0 ? "positive" : x < 0 ? "negative" : "neutral";
}

/** Formats a (possibly fractional) share count for display: more decimals for sub-share positions. */
function fmtShares(x) {
  if (x >= 100) return x.toFixed(1);
  if (x >= 1) return x.toFixed(3);
  return x.toFixed(4);
}

function renderHeader() {
  const equity = currentEquity();
  document.getElementById("statEquity").textContent = fmtMoney(equity);

  const todayChange = equity - state.dayStartEquity;
  const todayPct = state.dayStartEquity ? todayChange / state.dayStartEquity : 0;
  const todayEl = document.getElementById("statToday");
  todayEl.textContent = `${fmtMoney(todayChange)} (${fmtPct(todayPct)})`;
  todayEl.className = `stat-value ${signClass(todayChange)}`;

  const totalReturn = (equity - CONFIG.STARTING_CASH) / CONFIG.STARTING_CASH;
  const returnEl = document.getElementById("statReturn");
  returnEl.textContent = fmtPct(totalReturn);
  returnEl.className = `stat-value ${signClass(totalReturn)}`;

  const horizonEnd = state.startDate + CONFIG.HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const daysLeft = Math.max(0, Math.ceil((horizonEnd - Date.now()) / (24 * 60 * 60 * 1000)));
  document.getElementById("statDays").textContent = daysLeft;

  const equityEl = document.getElementById("statEquity");
  equityEl.className = `stat-value ${signClass(equity - CONFIG.STARTING_CASH)}`;

  document.getElementById("goalLabel").textContent = `Goal: ${fmtMoney(CONFIG.GOAL_EQUITY)}`;
  const goalRange = CONFIG.GOAL_EQUITY - CONFIG.STARTING_CASH;
  const goalProgress = goalRange > 0 ? clamp((equity - CONFIG.STARTING_CASH) / goalRange, 0, 1) : 0;
  document.getElementById("goalFill").style.width = `${(goalProgress * 100).toFixed(2)}%`;
  document.getElementById("goalPct").textContent = `${(goalProgress * 100).toFixed(2)}%`;
}

function renderHoldings() {
  const tbody = document.getElementById("holdingsBody");
  const tickers = Object.keys(state.positions);
  if (!tickers.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No open positions yet — the agent is watching the market.</td></tr>`;
  } else {
    tbody.innerHTML = tickers.map((ticker) => {
      const pos = state.positions[ticker];
      const price = latestPrice(ticker) || pos.avgCost;
      const pnl = (price - pos.avgCost) * pos.shares;
      const pnlPct = pos.avgCost ? (price - pos.avgCost) / pos.avgCost : 0;
      return `<tr>
        <td class="ticker-cell">${ticker}</td>
        <td>${fmtMoney(pos.shares * price)}</td>
        <td>${fmtShares(pos.shares)}</td>
        <td>${fmtMoney(pos.avgCost)}</td>
        <td>${fmtMoney(price)}</td>
        <td class="${signClass(pnl)}">${fmtMoney(pnl)} (${fmtPct(pnlPct)})</td>
      </tr>`;
    }).join("");
  }
  document.getElementById("cashLine").textContent = `Cash: ${fmtMoney(state.cash)}`;
}

function renderWatchlist() {
  const tbody = document.getElementById("watchlistBody");
  tbody.innerHTML = CONFIG.WATCHLIST.map((ticker) => {
    const signal = computeSignals(ticker);
    const price = latestPrice(ticker);
    const name = CONFIG.TICKER_NAMES[ticker] || "";

    if (!signal) {
      const priceCell = price ? fmtMoney(price) : "—";
      return `<tr>
        <td class="ticker-cell">${ticker}<span class="ticker-name">${name}</span></td>
        <td>${priceCell}</td>
        <td colspan="3" class="neutral">warming up…</td>
        <td><span class="signal-badge signal-hold">HOLD</span></td>
      </tr>`;
    }

    let badgeClass = "signal-hold", badgeText = "HOLD";
    if (signal.score >= CONFIG.BUY_THRESHOLD) { badgeClass = "signal-buy"; badgeText = "BUY"; }
    else if (signal.score <= CONFIG.SELL_THRESHOLD) { badgeClass = "signal-sell"; badgeText = "SELL"; }

    return `<tr>
      <td class="ticker-cell">${ticker}<span class="ticker-name">${name}</span></td>
      <td>${fmtMoney(signal.current)}</td>
      <td class="${signClass(signal.momentum)}">${fmtPct(signal.momentum)}</td>
      <td class="${signClass(-signal.deviation)}">${fmtPct(signal.deviation)}</td>
      <td>${(signal.volatility * 100).toFixed(1)}%</td>
      <td><span class="signal-badge ${badgeClass}">${badgeText}</span></td>
    </tr>`;
  }).join("");
}

const ACTION_LABELS = { buy: "Buy", sell: "Sell", add: "Add", trim: "Trim" };

function renderJournal() {
  const feed = document.getElementById("journalFeed");
  if (!state.journal.length) {
    feed.innerHTML = `<div class="empty-journal">No trades yet. The agent logs its reasoning here every time it acts.</div>`;
    return;
  }
  feed.innerHTML = state.journal.map((entry) => {
    const time = new Date(entry.t).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    return `<div class="journal-entry ${entry.action}">
      <div class="journal-meta">
        <span class="journal-action ${entry.action}">${ACTION_LABELS[entry.action] || entry.action} · ${entry.ticker}</span>
        <span>${time}</span>
      </div>
      <div class="journal-thesis">${entry.thesis}</div>
    </div>`;
  }).join("");
}

function renderStatus() {
  const banner = document.getElementById("statusBanner");
  if (!hasApiKey()) {
    banner.textContent = "No Finnhub API key set — open Settings (⚙) and paste your free API key to start fetching live prices.";
    banner.className = "status-banner";
    banner.classList.remove("hidden");
    return;
  }
  if (state.lastFetchError) {
    banner.textContent = state.lastFetchError;
    banner.className = "status-banner error";
    banner.classList.remove("hidden");
    return;
  }
  banner.classList.add("hidden");
}

function renderFooter() {
  const el = document.getElementById("lastUpdated");
  if (!state.lastPriceUpdate) {
    el.textContent = "Never updated";
  } else {
    el.textContent = `Last price update: ${new Date(state.lastPriceUpdate).toLocaleTimeString()}`;
  }
}

function renderAll() {
  renderStatus();
  renderHeader();
  renderHoldings();
  renderWatchlist();
  renderJournal();
  renderFooter();
  drawChart();
}

/* ============================ EVENT HANDLERS ==============================
   Settings panel (API key + watchlist editing) and the reset button.
   ========================================================================== */

function openSettings() {
  document.getElementById("apiKeyInput").value = hasApiKey() ? CONFIG.FINNHUB_API_KEY : "";
  document.getElementById("watchlistInput").value = CONFIG.WATCHLIST.join(", ");
  document.getElementById("settingsOverlay").classList.remove("hidden");
}

function closeSettings() {
  document.getElementById("settingsOverlay").classList.add("hidden");
}

function saveSettings() {
  const key = document.getElementById("apiKeyInput").value.trim();
  const watchlistRaw = document.getElementById("watchlistInput").value;
  const watchlist = watchlistRaw
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  if (key) CONFIG.FINNHUB_API_KEY = key;
  if (watchlist.length) CONFIG.WATCHLIST = watchlist;

  saveConfigOverrides();

  // Keep history for tickers still in the list; drop the rest, seed new ones empty.
  const keep = {};
  for (const t of CONFIG.WATCHLIST) if (state.priceHistory[t]) keep[t] = state.priceHistory[t];
  state.priceHistory = keep;

  saveState();
  closeSettings();
  renderAll();
  refreshPrices(); // pick up the new watchlist / key immediately
}

function resetSimulation() {
  if (!confirm(`Reset the simulation? This wipes cash, positions, and the trade journal, and starts a fresh ${fmtMoney(CONFIG.STARTING_CASH)} 1-year run.`)) {
    return;
  }
  state = defaultState();
  saveState();
  closeSettings();
  renderAll();
}

function wireEvents() {
  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("closeSettingsBtn").addEventListener("click", closeSettings);
  document.getElementById("settingsOverlay").addEventListener("click", (e) => {
    if (e.target.id === "settingsOverlay") closeSettings();
  });
  document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
  document.getElementById("resetBtn").addEventListener("click", resetSimulation);
  window.addEventListener("resize", () => drawChart());
}

/* =========================== BOOTSTRAP / POLLING ===========================
   Price polling is staggered across each 60s cycle to stay well within
   Finnhub's free-tier rate limit, and the trading engine runs once per
   completed cycle (not per individual quote) so decisions always see a
   consistent snapshot of the whole watchlist.
   ========================================================================== */

async function refreshPrices() {
  if (!hasApiKey()) {
    renderStatus();
    return;
  }

  let sawError = null;
  for (let i = 0; i < CONFIG.WATCHLIST.length; i++) {
    const ticker = CONFIG.WATCHLIST[i];
    if (i > 0) await delay(CONFIG.QUOTE_STAGGER_MS);
    try {
      const quote = await fetchQuote(ticker);
      const hist = state.priceHistory[ticker] || (state.priceHistory[ticker] = []);
      hist.push({ t: Date.now(), p: quote.c });
      if (hist.length > CONFIG.MAX_HISTORY_POINTS) {
        state.priceHistory[ticker] = hist.slice(-CONFIG.MAX_HISTORY_POINTS);
      }
    } catch (err) {
      sawError = err.message;
    }
  }

  state.lastFetchError = sawError;
  runTradingEngine();
  recalcPortfolio();
  saveState();
  renderAll();
}

async function refreshNews() {
  if (!hasApiKey()) return;
  try {
    const headlines = await fetchNews();
    updateGlobalSentiment(headlines);
    updateTickerMentions(headlines);
    saveState();
  } catch (err) {
    console.warn("News refresh failed:", err.message);
  }
}

function init() {
  loadConfigOverrides();
  state = loadState();
  wireEvents();
  renderAll();

  // Kick off both loops immediately, then on their intervals.
  refreshPrices();
  refreshNews();
  setInterval(refreshPrices, CONFIG.PRICE_POLL_MS);
  setInterval(refreshNews, CONFIG.NEWS_POLL_MS);

  // Keep header stats (esp. "days remaining") fresh even between price polls.
  setInterval(renderHeader, 60 * 1000);
}

document.addEventListener("DOMContentLoaded", init);
