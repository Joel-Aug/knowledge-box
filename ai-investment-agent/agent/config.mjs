// ==========================================================================
// AI INVESTMENT AGENT — shared configuration for the background runner
// --------------------------------------------------------------------------
// This is the server-side source of truth. The GitHub Actions workflow runs
// agent/run.mjs on a schedule, which reads this file, talks to Finnhub, and
// commits the result to data/state.json. The front-end (app.js) only reads
// that JSON file — it never talks to Finnhub and never sees the API key.
//
// The Finnhub key itself is NOT here — it's read from the FINNHUB_API_KEY
// GitHub Actions secret (Settings -> Secrets and variables -> Actions) so it
// never appears in a committed file or in the public page's source.
// ==========================================================================
export const CONFIG = {
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

  // --- indicator lookback windows (measured in polling cycles) ---
  SMA_LOOKBACK: 20,        // ~5 hours of history at a 15-min cycle
  MOMENTUM_LOOKBACK: 15,
  VOL_LOOKBACK: 20,
  MAX_HISTORY_POINTS: 1000, // cap stored price points per ticker

  // --- signal scaling: how big a raw move maps to a "full strength" ±1 signal
  MOMENTUM_SCALE: 0.03,
  REVERSION_SCALE: 0.05,

  // --- how the three signals are blended into one composite score ---
  W_MOMENTUM: 0.55,
  W_REVERSION: 0.35,   // subtracted: far ABOVE average pulls the score down
  W_SENTIMENT: 0.20,

  // --- decision thresholds on the composite score (roughly -1..+1) ---
  BUY_THRESHOLD: 0.30,
  ADD_THRESHOLD: 0.45,
  SELL_THRESHOLD: -0.25,
  TRIM_SCORE_CEILING: 0.05,

  // --- position sizing & risk rules ---
  BASE_ALLOCATION_PCT: 0.09,
  VOL_PENALTY: 8,
  MAX_POSITION_PCT: 0.20,
  CASH_BUFFER_PCT: 0.10,
  MIN_TRADE_PCT: 0.01,
  MIN_TRADE_FLOOR: 1,
  ALLOW_FRACTIONAL_SHARES: true,

  // --- avoid thrashing the same name every single run ---
  // At a 15-min run cadence, a 20-min cooldown is ~1-2 cycles.
  TRADE_COOLDOWN_MS: 20 * 60 * 1000,
};

// Simple keyword lexicon for headline sentiment. Not NLP — just a tilt.
export const SENTIMENT_WORDS = {
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
