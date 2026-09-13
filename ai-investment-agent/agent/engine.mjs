// ==========================================================================
// AI INVESTMENT AGENT — trading engine (pure logic, no I/O)
// --------------------------------------------------------------------------
// THE AGENT'S OBJECTIVE: maximize total portfolio equity toward CONFIG.GOAL_EQUITY.
// Every rule here exists in service of that single objective, subject to hard
// risk constraints (position cap, cash buffer). Execution is fully
// deterministic and auditable — no live LLM calls — so every trade can be
// traced back to the numbers in its logged thesis.
//
// This module has no idea where `state` comes from or where it's saved —
// that's agent/run.mjs's job (fetch quotes/news, load/save state.json). That
// separation is what lets this file be unit-tested with fake data and reused
// without duplicating the math anywhere else.
// ==========================================================================
import { SENTIMENT_WORDS } from "./config.mjs";

export function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = mean(arr.map((x) => (x - m) * (x - m)));
  return Math.sqrt(variance);
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

export function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

/** Formats a (possibly fractional) share count: more decimals for sub-share positions. */
export function fmtShares(x) {
  if (x >= 100) return x.toFixed(1);
  if (x >= 1) return x.toFixed(3);
  return x.toFixed(4);
}

export function defaultState(CONFIG, now = Date.now()) {
  return {
    cash: CONFIG.STARTING_CASH,
    positions: {},
    history: [{ t: now, v: CONFIG.STARTING_CASH }],
    journal: [],
    priceHistory: {},
    lastTradeTime: {},
    startDate: now,
    dayStartDate: new Date(now).toDateString(),
    dayStartEquity: CONFIG.STARTING_CASH,
    sentiment: { global: 0, updatedAt: 0, headlineCount: 0, mentions: {} },
    lastPriceUpdate: 0,
    lastFetchError: null,
    watchlist: CONFIG.WATCHLIST,
    // A small snapshot of display-relevant config, so the front-end never
    // needs its own copy of these values (and can't drift from the agent).
    config: {
      startingCash: CONFIG.STARTING_CASH,
      goalEquity: CONFIG.GOAL_EQUITY,
      horizonDays: CONFIG.HORIZON_DAYS,
      buyThreshold: CONFIG.BUY_THRESHOLD,
      sellThreshold: CONFIG.SELL_THRESHOLD,
      tickerNames: CONFIG.TICKER_NAMES,
    },
  };
}

/**
 * Computes momentum / mean-reversion / volatility signals for one ticker
 * from its stored price history. Returns null if there isn't enough history
 * yet (needs a warm-up period after first launch or a watchlist change).
 */
export function computeSignals(state, CONFIG, ticker) {
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

  const tickerSentiment = tickerSentimentTilt(state, ticker);

  const momentumSignal = clamp(momentum / CONFIG.MOMENTUM_SCALE, -1, 1);
  const reversionSignal = clamp(deviation / CONFIG.REVERSION_SCALE, -1, 1);

  const score =
    CONFIG.W_MOMENTUM * momentumSignal -
    CONFIG.W_REVERSION * reversionSignal +
    CONFIG.W_SENTIMENT * tickerSentiment;

  return { ticker, current, sma, deviation, momentum, volatility, sentiment: tickerSentiment, score };
}

/* ============================== SENTIMENT ================================= */

export function scoreHeadlineText(text) {
  const lower = text.toLowerCase();
  let pos = 0, neg = 0;
  for (const w of SENTIMENT_WORDS.positive) if (lower.includes(w)) pos++;
  for (const w of SENTIMENT_WORDS.negative) if (lower.includes(w)) neg++;
  return { pos, neg };
}

export function updateGlobalSentiment(state, headlines) {
  let pos = 0, neg = 0;
  for (const h of headlines) {
    const text = `${h.headline || ""} ${h.summary || ""}`;
    const s = scoreHeadlineText(text);
    pos += s.pos;
    neg += s.neg;
  }
  const total = pos + neg;
  const tilt = total === 0 ? 0 : (pos - neg) / total;
  state.sentiment = {
    ...state.sentiment,
    global: clamp(tilt, -1, 1),
    updatedAt: Date.now(),
    headlineCount: headlines.length,
  };
}

export function tickerSentimentTilt(state, ticker) {
  const base = (state.sentiment && state.sentiment.global) || 0;
  const mentions = state.sentiment && state.sentiment.mentions;
  const bonus = mentions && mentions[ticker] ? mentions[ticker] : 0;
  return clamp(base * 0.7 + bonus * 0.3, -1, 1);
}

export function updateTickerMentions(state, CONFIG, headlines) {
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

/* ============================ PORTFOLIO MATH =============================== */

export function currentEquity(state) {
  let equity = state.cash;
  for (const ticker of Object.keys(state.positions)) {
    const pos = state.positions[ticker];
    const hist = state.priceHistory[ticker];
    const price = hist && hist.length ? hist[hist.length - 1].p : pos.avgCost;
    equity += pos.shares * price;
  }
  return equity;
}

export function latestPrice(state, ticker) {
  const hist = state.priceHistory[ticker];
  return hist && hist.length ? hist[hist.length - 1].p : null;
}

function onCooldown(state, CONFIG, ticker, now) {
  const last = state.lastTradeTime[ticker];
  return !!last && now - last < CONFIG.TRADE_COOLDOWN_MS;
}

export function targetPositionValue(CONFIG, signal, equity) {
  const base = equity * CONFIG.BASE_ALLOCATION_PCT;
  const volAdjusted = base / (1 + signal.volatility * CONFIG.VOL_PENALTY);
  return Math.min(volAdjusted, equity * CONFIG.MAX_POSITION_PCT);
}

export function minTradeValue(CONFIG, equity) {
  return Math.max(CONFIG.MIN_TRADE_FLOOR, equity * CONFIG.MIN_TRADE_PCT);
}

export function sharesFromSpend(CONFIG, spend, price) {
  const raw = spend / price;
  const shares = CONFIG.ALLOW_FRACTIONAL_SHARES ? raw : Math.floor(raw);
  return Math.round(shares * 1e6) / 1e6;
}

function logTrade(state, action, ticker, shares, price, thesis, now) {
  state.journal.unshift({ t: now, action, ticker, shares, price, thesis });
  state.journal = state.journal.slice(0, 200);
  state.lastTradeTime[ticker] = now;
}

function buyThesis(CONFIG, ticker, signal, shares, price, allocPct, opening) {
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
    `Momentum is ${trendWord} (${pct(signal.momentum)} over updates), price sits ${pct(Math.abs(signal.deviation))} ${devWord} its average, ` +
    `and the composite score fell below the sell threshold. Freeing this capital to redeploy toward higher-conviction opportunities.`
  );
}

function trimThesis(ticker, signal, shares, price, reason) {
  return (
    `Trimming ${ticker}: sell ${fmtShares(shares)} sh @ $${price.toFixed(2)} (~$${(shares * price).toFixed(2)}). ${reason} ` +
    `Composite score is ${signal.score.toFixed(2)} — not bearish enough to exit fully, but conviction has cooled ` +
    `and/or the position has grown beyond its risk-adjusted target, so trimming back toward the 20% cap.`
  );
}

/** Runs one full evaluation + trading pass across the whole watchlist. Mutates `state` in place. */
export function runTradingEngine(state, CONFIG, now = Date.now()) {
  const equity = currentEquity(state);
  const signals = {};
  for (const ticker of CONFIG.WATCHLIST) {
    const s = computeSignals(state, CONFIG, ticker);
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

    if (signal.score <= CONFIG.SELL_THRESHOLD && !onCooldown(state, CONFIG, ticker, now)) {
      const proceeds = pos.shares * price;
      const pnl = proceeds - pos.shares * pos.avgCost;
      state.cash += proceeds;
      const thesis = sellThesis(ticker, signal, pos.shares, price, pnl);
      logTrade(state, "sell", ticker, pos.shares, price, thesis, now);
      delete state.positions[ticker];
      continue;
    }

    if (overCap && signal.score < CONFIG.TRIM_SCORE_CEILING && !onCooldown(state, CONFIG, ticker, now)) {
      const target = targetPositionValue(CONFIG, signal, equity);
      const targetShares = sharesFromSpend(CONFIG, target, price);
      const trimShares = Math.max(0, pos.shares - targetShares);
      if (trimShares > 0 && trimShares * price >= minTradeValue(CONFIG, equity)) {
        state.cash += trimShares * price;
        const thesis = trimThesis(ticker, signal, trimShares, price, "Price appreciation pushed this position above the 20% risk cap.");
        logTrade(state, "trim", ticker, trimShares, price, thesis, now);
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
    if (onCooldown(state, CONFIG, ticker, now)) continue;

    const equityNow = currentEquity(state);
    const target = targetPositionValue(CONFIG, signal, equityNow);
    const existing = state.positions[ticker];
    const price = signal.current;

    if (existing) {
      if (signal.score < CONFIG.ADD_THRESHOLD) continue;
      const currentValue = existing.shares * price;
      if (currentValue >= target * 0.85) continue;

      const addValue = target - currentValue;
      const cashAfterBuffer = state.cash - equityNow * CONFIG.CASH_BUFFER_PCT;
      const spend = Math.min(addValue, Math.max(0, cashAfterBuffer));
      const shares = sharesFromSpend(CONFIG, spend, price);
      if (shares <= 0 || shares * price < minTradeValue(CONFIG, equityNow)) continue;

      const cost = shares * price;
      existing.avgCost = (existing.avgCost * existing.shares + cost) / (existing.shares + shares);
      existing.shares += shares;
      state.cash -= cost;
      const allocPct = (existing.shares * price) / currentEquity(state);
      const thesis = buyThesis(CONFIG, ticker, signal, shares, price, allocPct, false);
      logTrade(state, "add", ticker, shares, price, thesis, now);
    } else {
      const cashAfterBuffer = state.cash - equityNow * CONFIG.CASH_BUFFER_PCT;
      const spend = Math.min(target, Math.max(0, cashAfterBuffer));
      const shares = sharesFromSpend(CONFIG, spend, price);
      if (shares <= 0 || shares * price < minTradeValue(CONFIG, equityNow)) continue;

      const cost = shares * price;
      state.positions[ticker] = { shares, avgCost: price };
      state.cash -= cost;
      const allocPct = cost / currentEquity(state);
      const thesis = buyThesis(CONFIG, ticker, signal, shares, price, allocPct, true);
      logTrade(state, "buy", ticker, shares, price, thesis, now);
    }
  }

  // Publish this run's signals so the front-end can show live BUY/SELL/HOLD
  // badges without duplicating any of the math above.
  state.signals = signals;
}

export function recalcPortfolio(state, CONFIG, now = Date.now()) {
  const equity = currentEquity(state);
  const today = new Date(now).toDateString();
  if (state.dayStartDate !== today) {
    state.dayStartDate = today;
    state.dayStartEquity = equity;
  }

  state.history.push({ t: now, v: equity });
  if (state.history.length > CONFIG.MAX_HISTORY_POINTS) {
    state.history = state.history.slice(-CONFIG.MAX_HISTORY_POINTS);
  }
  state.lastPriceUpdate = now;
  state.watchlist = CONFIG.WATCHLIST;
  state.config = {
    startingCash: CONFIG.STARTING_CASH,
    goalEquity: CONFIG.GOAL_EQUITY,
    horizonDays: CONFIG.HORIZON_DAYS,
    buyThreshold: CONFIG.BUY_THRESHOLD,
    sellThreshold: CONFIG.SELL_THRESHOLD,
    tickerNames: CONFIG.TICKER_NAMES,
  };
}
