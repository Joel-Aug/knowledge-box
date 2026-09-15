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
import { SENTIMENT_WORDS, CYCLICAL_INDUSTRIES } from "./config.mjs";

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

// A small snapshot of display-relevant config, so the front-end never needs
// its own copy of these values (and can't drift from the agent).
function buildConfigSnapshot(CONFIG) {
  return {
    startingCash: CONFIG.STARTING_CASH,
    goalEquity: CONFIG.GOAL_EQUITY,
    horizonDays: CONFIG.HORIZON_DAYS,
    buyThreshold: CONFIG.BUY_THRESHOLD,
    sellThreshold: CONFIG.SELL_THRESHOLD,
    tickerNames: CONFIG.TICKER_NAMES,
    lynchBuyScore: CONFIG.LYNCH_BUY_SCORE,
    pegSell: CONFIG.PEG_SELL,
  };
}

export function defaultState(CONFIG, now = Date.now()) {
  return {
    cash: CONFIG.STARTING_CASH,
    positions: {},
    history: [{ t: now, v: CONFIG.STARTING_CASH }],
    journal: [],
    priceHistory: {},
    fundamentals: {},
    lastTradeTime: {},
    startDate: now,
    dayStartDate: new Date(now).toDateString(),
    dayStartEquity: CONFIG.STARTING_CASH,
    sentiment: { global: 0, updatedAt: 0, headlineCount: 0, mentions: {} },
    lastPriceUpdate: 0,
    lastFetchError: null,
    watchlist: CONFIG.WATCHLIST,
    config: buildConfigSnapshot(CONFIG),
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

/* ========================== LYNCH FUNDAMENTALS =============================
   Peter Lynch-style growth classification and scoring. This is the PRIMARY
   buy/sell driver for any ticker with usable fundamentals (real stocks);
   ETFs/indices have no EPS/PE and fall back to the legacy momentum+
   mean-reversion score above. Price momentum here is only ever a SECONDARY
   confirmation signal (see computeLynchSignal's sharpDowntrend gate) — it
   can delay a buy, but it never triggers a sell on its own, so a stock
   whose fundamentals are still intact is never sold on a short-term dip.
   ========================================================================= */

export function isCyclicalIndustry(industry) {
  if (!industry) return false;
  const lower = industry.toLowerCase();
  return CYCLICAL_INDUSTRIES.some((k) => lower.includes(k));
}

/** Maps a PEG ratio to a 0-100 component: <1.0 strong buy, 1.0-1.5 moderate, 1.5-2.0 neutral, >2.0 avoid. */
export function pegScoreComponent(peg) {
  if (peg === null || !isFinite(peg) || peg <= 0) return 0;
  if (peg < 1.0) return 100 - peg * 10;                  // 90-100
  if (peg < 1.5) return 90 - (peg - 1.0) * 40;            // 70-90
  if (peg < 2.0) return 70 - (peg - 1.5) * 60;            // 40-70
  return Math.max(0, 40 - (peg - 2.0) * 20);              // tapers off below 40
}

/** Small bonus for sitting in Lynch's 20-25% "sweet spot" EPS growth rate. Growth % is a whole number (22, not 0.22). */
export function growthSweetSpotBonus(growthPct) {
  if (growthPct >= 20 && growthPct <= 25) return 10;
  if ((growthPct >= 15 && growthPct < 20) || (growthPct > 25 && growthPct <= 35)) return 5;
  return 0;
}

/** Penalizes a weak balance sheet; a debt/equity above DEBT_EQUITY_WEAK can never earn a strong-buy score. */
export function debtEquityPenalty(CONFIG, debtEquity) {
  if (debtEquity === null || debtEquity === undefined || !isFinite(debtEquity)) {
    return { penalty: 0, weak: false };
  }
  if (debtEquity > CONFIG.DEBT_EQUITY_WEAK) return { penalty: 30, weak: true };
  if (debtEquity > CONFIG.DEBT_EQUITY_MODERATE) return { penalty: 15, weak: false };
  if (debtEquity > CONFIG.DEBT_EQUITY_MILD) return { penalty: 5, weak: false };
  return { penalty: 0, weak: false };
}

/** Category multiplier layered on top of the existing volatility-based sizing (still capped at MAX_POSITION_PCT). */
export function categoryAllocationMultiplier(CONFIG, lynch) {
  if (!lynch) return 1;
  const mult = CONFIG.CATEGORY_ALLOCATION_MULT[lynch.category] ?? 1;
  const confidenceMult = lynch.unsustainableGrowth ? CONFIG.UNSUSTAINABLE_GROWTH_SIZE_MULT : 1;
  return mult * confidenceMult;
}

const LYNCH_CATEGORY_RANK = {
  "Fast Grower": 3, "Stalwart": 2, "Slow Grower": 1, "Cyclical": 0, "Turnaround": 0,
};

function classifyLynchCategory(CONFIG, growthPct, industry, drawdown, improvingFundamentals) {
  if (drawdown >= CONFIG.TURNAROUND_DRAWDOWN && improvingFundamentals) return "Turnaround";
  if (isCyclicalIndustry(industry)) return "Cyclical";
  if (growthPct >= CONFIG.FAST_GROWER_MIN_PCT) return "Fast Grower";
  if (growthPct >= CONFIG.STALWART_MIN_PCT) return "Stalwart";
  return "Slow Grower";
}

/**
 * Builds (or refreshes) the cached, slow-moving fundamentals record for one
 * ticker: category, PEG inputs, and transition flags vs. the last refresh
 * (growth decelerating, debt spiking, category drifting to a worse bucket).
 * Pure — takes the raw Finnhub-derived numbers plus the previous cached
 * record, no I/O. Called from run.mjs only when a refresh is actually due.
 */
export function buildFundamentalsRecord(CONFIG, priceHistory, prevRecord, raw, now) {
  const prices = (priceHistory || []).map((p) => p.p);
  const peak = prices.length ? Math.max(...prices) : 0;
  const current = prices.length ? prices[prices.length - 1] : 0;
  const drawdown = peak > 0 ? (peak - current) / peak : 0;

  if (raw.epsGrowth === null || raw.epsGrowth === undefined) {
    // No usable EPS growth data (typically an ETF/index) — legacy momentum
    // scoring drives this ticker instead of Lynch scoring.
    return {
      updatedAt: now, category: "ETF/Index", pe: null, epsGrowth: null,
      epsGrowthRecent: null, growthPct: null, debtEquity: raw.debtEquity ?? null,
      fcfProxy: raw.fcfProxy ?? null, marketCap: raw.marketCap ?? null,
      industry: raw.industry ?? null, drawdown, unsustainableGrowth: false,
      flags: { categoryDowngrade: false, growthDecel: false, debtSpike: false },
    };
  }

  const growthPct = raw.epsGrowth * 100;
  const improving = raw.epsGrowthRecent != null && raw.epsGrowthRecent > raw.epsGrowth && raw.epsGrowthRecent > 0;
  const category = classifyLynchCategory(CONFIG, growthPct, raw.industry, drawdown, improving);
  const unsustainableGrowth = growthPct > CONFIG.UNSUSTAINABLE_GROWTH_PCT;

  let categoryDowngrade = false, growthDecel = false, debtSpike = false;
  if (prevRecord) {
    const prevRank = LYNCH_CATEGORY_RANK[prevRecord.category];
    const newRank = LYNCH_CATEGORY_RANK[category];
    if (prevRank !== undefined && newRank !== undefined && newRank < prevRank) categoryDowngrade = true;

    if (prevRecord.growthPct != null && (prevRecord.growthPct - growthPct) >= CONFIG.GROWTH_DECEL_DROP_PP && growthPct < prevRecord.growthPct) {
      growthDecel = true;
    }
    if (prevRecord.debtEquity != null && raw.debtEquity != null &&
        (raw.debtEquity - prevRecord.debtEquity) >= CONFIG.DEBT_SPIKE_DELTA && raw.debtEquity > CONFIG.DEBT_EQUITY_MODERATE) {
      debtSpike = true;
    }
  }

  return {
    updatedAt: now,
    category,
    pe: raw.pe ?? null,
    epsGrowth: raw.epsGrowth,
    epsGrowthRecent: raw.epsGrowthRecent ?? null,
    growthPct,
    debtEquity: raw.debtEquity ?? null,
    fcfProxy: raw.fcfProxy ?? null,
    marketCap: raw.marketCap ?? null,
    industry: raw.industry ?? null,
    drawdown,
    unsustainableGrowth,
    flags: {
      categoryDowngrade, growthDecel, debtSpike,
      prevCategory: prevRecord ? prevRecord.category : null,
      prevGrowthPct: prevRecord ? prevRecord.growthPct : null,
      prevDebtEquity: prevRecord ? prevRecord.debtEquity : null,
    },
  };
}

/**
 * Combines a cached fundamentals record with this run's live momentum signal
 * into the final 0-100 Lynch Score. Returns null when there's no usable PEG
 * (no P/E, or EPS growth isn't positive) — the caller then falls back to the
 * legacy momentum/mean-reversion score for that ticker.
 */
export function computeLynchSignal(CONFIG, fundamentals, momentum, deviation) {
  if (!fundamentals || fundamentals.category === "ETF/Index" || fundamentals.pe == null || fundamentals.growthPct == null) {
    return null;
  }
  const peg = fundamentals.pe > 0 && fundamentals.growthPct > 0 ? fundamentals.pe / fundamentals.growthPct : null;
  const pegScore = pegScoreComponent(peg);
  const growthBonus = growthSweetSpotBonus(fundamentals.growthPct);
  const { penalty: dePenalty, weak: weakBalanceSheet } = debtEquityPenalty(CONFIG, fundamentals.debtEquity);
  const momentumAdj = clamp(momentum / CONFIG.MOMENTUM_SCALE, -1, 1) * 10;

  let lynchScore = clamp(pegScore + growthBonus - dePenalty + momentumAdj, 0, 100);
  if (weakBalanceSheet) lynchScore = Math.min(lynchScore, CONFIG.LYNCH_BUY_SCORE - 5);

  const sharpDowntrend = momentum <= CONFIG.LYNCH_MOMENTUM_BREAKDOWN && deviation <= CONFIG.LYNCH_DEVIATION_BREAKDOWN;

  return { peg, pegScore, growthBonus, dePenalty, weakBalanceSheet, momentumAdj, lynchScore, sharpDowntrend };
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
  const base = equity * CONFIG.BASE_ALLOCATION_PCT * categoryAllocationMultiplier(CONFIG, signal.lynch);
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

/* ------------------------- Lynch-style trade journal ------------------------ */

function debtWord(de) {
  if (de === null || de === undefined) return "unknown debt/equity";
  if (de <= 0.5) return "low debt/equity";
  if (de <= 1.0) return "moderate debt/equity";
  if (de <= 2.0) return "elevated debt/equity";
  return "high debt/equity";
}

function lynchBuyThesis(CONFIG, ticker, signal, shares, price, allocPct, opening) {
  const f = signal.fundamentals, l = signal.lynch;
  const pegText = l.peg === null ? "PEG n/a (no/negative growth)" : `PEG ${l.peg.toFixed(2)}`;
  const unsustainableNote = f.unsustainableGrowth
    ? ` Growth above ${CONFIG.UNSUSTAINABLE_GROWTH_PCT}% is flagged as an unsustainable-growth risk, so this position is sized down accordingly.`
    : "";
  return (
    `${ticker} — ${pegText}, EPS growth ${f.growthPct.toFixed(0)}%, ${debtWord(f.debtEquity)}, classified as ${f.category}. ` +
    `Lynch Score ${l.lynchScore.toFixed(0)}. ${opening ? "Initiating" : "Adding to"} position: invest ~$${(shares * price).toFixed(2)} ` +
    `(${fmtShares(shares)} sh @ $${price.toFixed(2)}) — ${pct(allocPct)} of equity.${unsustainableNote} ` +
    `Growth priced attractively relative to earnings expansion. Objective: compound toward the $${CONFIG.GOAL_EQUITY.toLocaleString("en-US")} goal.`
  );
}

function lynchSellThesis(CONFIG, ticker, signal, shares, price, pnl, reason) {
  const f = signal.fundamentals, l = signal.lynch;
  const growthText = f.growthPct === null ? "growth unknown" : `${f.growthPct.toFixed(0)}%`;
  let reasonText;
  if (reason === "peg") {
    reasonText = `PEG expanded to ${l.peg.toFixed(2)} (above the ${CONFIG.PEG_SELL.toFixed(1)} sell threshold) while EPS growth sits at ${growthText}. ` +
      `Thesis broken — valuation has run ahead of earnings growth.`;
  } else if (reason === "growthDecel") {
    reasonText = `EPS growth decelerated sharply to ${growthText} (was ${f.flags.prevGrowthPct?.toFixed(0)}% last quarter). Thesis broken — the growth trend has faded.`;
  } else if (reason === "debtSpike") {
    reasonText = `Debt/equity jumped to ${f.debtEquity.toFixed(2)} (was ${f.flags.prevDebtEquity?.toFixed(2)}). Balance sheet risk now outweighs the growth story.`;
  } else {
    reasonText = `${ticker} has drifted from ${f.flags.prevCategory} to ${f.category} — Lynch's own warning sign of a fading growth story. Thesis broken.`;
  }
  return (
    `${ticker} — sell ${fmtShares(shares)} sh @ $${price.toFixed(2)} (~$${(shares * price).toFixed(2)}) for a ${pnl >= 0 ? "gain" : "loss"} of $${Math.abs(pnl).toFixed(2)}. ` +
    `${reasonText} Exiting position.`
  );
}

/**
 * Attaches fundamentals + the Lynch Score to a momentum signal, when this
 * ticker has usable EPS/PE data. `signal.fundamentals` is always populated
 * once fetched (for display, even for ETFs); `signal.lynch` only exists when
 * there's a real PEG to score, and is what drives buy/sell/sizing below.
 */
function attachLynch(state, CONFIG, signal) {
  const fundamentals = state.fundamentals && state.fundamentals[signal.ticker];
  if (!fundamentals) return;
  signal.fundamentals = fundamentals;
  const lynch = computeLynchSignal(CONFIG, fundamentals, signal.momentum, signal.deviation);
  if (lynch) {
    signal.lynch = lynch;
    signal.fundamentals = { ...fundamentals, peg: lynch.peg, lynchScore: lynch.lynchScore };
  }
}

/** Runs one full evaluation + trading pass across the whole watchlist. Mutates `state` in place. */
export function runTradingEngine(state, CONFIG, now = Date.now()) {
  const equity = currentEquity(state);
  const signals = {};
  for (const ticker of CONFIG.WATCHLIST) {
    const s = computeSignals(state, CONFIG, ticker);
    if (s) {
      attachLynch(state, CONFIG, s);
      signals[ticker] = s;
    }
  }

  // --- Pass 1: sells / trims first, to free up cash before considering buys.
  // For a Lynch-classified ticker, selling is driven ONLY by fundamentals
  // (PEG, growth deceleration, debt spike, category downgrade) — never by a
  // short-term price dip. That's deliberate: the whole point of "hold when
  // the thesis is intact" is that a stock with a good PEG and healthy
  // balance sheet doesn't get sold just because it pulled back this week.
  for (const ticker of Object.keys(state.positions)) {
    const signal = signals[ticker];
    const pos = state.positions[ticker];
    if (!signal || !pos || pos.shares <= 0) continue;

    const price = signal.current;
    const positionValue = pos.shares * price;
    const overCap = positionValue > equity * CONFIG.MAX_POSITION_PCT;
    const lynch = signal.lynch;

    let sellReason = null;
    if (lynch) {
      if (lynch.peg !== null && lynch.peg > CONFIG.PEG_SELL) sellReason = "peg";
      else if (signal.fundamentals.flags.growthDecel) sellReason = "growthDecel";
      else if (signal.fundamentals.flags.debtSpike) sellReason = "debtSpike";
      else if (signal.fundamentals.flags.categoryDowngrade) sellReason = "categoryDowngrade";
    } else if (signal.score <= CONFIG.SELL_THRESHOLD) {
      sellReason = "legacy";
    }

    if (sellReason && !onCooldown(state, CONFIG, ticker, now)) {
      const proceeds = pos.shares * price;
      const pnl = proceeds - pos.shares * pos.avgCost;
      state.cash += proceeds;
      const thesis = lynch
        ? lynchSellThesis(CONFIG, ticker, signal, pos.shares, price, pnl, sellReason)
        : sellThesis(ticker, signal, pos.shares, price, pnl);
      logTrade(state, "sell", ticker, pos.shares, price, thesis, now);
      delete state.positions[ticker];
      continue;
    }

    const convictionCooled = lynch ? lynch.lynchScore < CONFIG.LYNCH_TRIM_CEILING : signal.score < CONFIG.TRIM_SCORE_CEILING;
    if (overCap && convictionCooled && !onCooldown(state, CONFIG, ticker, now)) {
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
  // For Lynch-classified tickers: Lynch Score must clear the buy bar, the
  // balance sheet must be healthy, and momentum must not be actively
  // breaking down (secondary confirmation — a great PEG still waits out a
  // sharp confirmed downtrend rather than buying into it).
  const buyCandidates = Object.values(signals)
    .filter((s) => (s.lynch
      ? s.lynch.lynchScore >= CONFIG.LYNCH_BUY_SCORE && !s.lynch.weakBalanceSheet && !s.lynch.sharpDowntrend
      : s.score >= CONFIG.BUY_THRESHOLD))
    .sort((a, b) => (b.lynch ? b.lynch.lynchScore : b.score * 100) - (a.lynch ? a.lynch.lynchScore : a.score * 100));

  for (const signal of buyCandidates) {
    const ticker = signal.ticker;
    if (onCooldown(state, CONFIG, ticker, now)) continue;
    const lynch = signal.lynch;

    const equityNow = currentEquity(state);
    const target = targetPositionValue(CONFIG, signal, equityNow);
    const existing = state.positions[ticker];
    const price = signal.current;

    if (existing) {
      const addOk = lynch ? lynch.lynchScore >= CONFIG.LYNCH_ADD_SCORE : signal.score >= CONFIG.ADD_THRESHOLD;
      if (!addOk) continue;
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
      const thesis = lynch
        ? lynchBuyThesis(CONFIG, ticker, signal, shares, price, allocPct, false)
        : buyThesis(CONFIG, ticker, signal, shares, price, allocPct, false);
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
      const thesis = lynch
        ? lynchBuyThesis(CONFIG, ticker, signal, shares, price, allocPct, true)
        : buyThesis(CONFIG, ticker, signal, shares, price, allocPct, true);
      logTrade(state, "buy", ticker, shares, price, thesis, now);
    }
  }

  // Publish this run's signals so the front-end can show live BUY/SELL/HOLD
  // badges and Lynch categories/scores without duplicating any of the math above.
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
  state.config = buildConfigSnapshot(CONFIG);
}
