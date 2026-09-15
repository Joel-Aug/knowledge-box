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

  // ========================================================================
  // PETER LYNCH-STYLE GROWTH FUNDAMENTALS
  // Fundamentals (EPS growth, P/E, debt/equity) move on a quarterly cadence,
  // not minute to minute, so they're fetched and cached separately from the
  // price loop above and only refreshed this often.
  // ========================================================================
  FUNDAMENTALS_REFRESH_MS: 6 * 60 * 60 * 1000,

  // --- category thresholds (EPS growth %, year-over-year) ---
  FAST_GROWER_MIN_PCT: 20,
  STALWART_MIN_PCT: 10,          // below this -> Slow Grower
  UNSUSTAINABLE_GROWTH_PCT: 50,  // flagged as a risk, not auto-rejected — see UNSUSTAINABLE_GROWTH_SIZE_MULT
  TURNAROUND_DRAWDOWN: 0.30,     // price down 30%+ from its recent high...
  // ...with the latest quarter's YoY EPS growth improving on the trailing rate counts as "recovering"

  // --- PEG (P/E ÷ EPS growth %) decision bands ---
  PEG_STRONG_BUY: 1.0,
  PEG_MODERATE_BUY: 1.5,
  PEG_SELL: 2.0,                 // PEG above this -> avoid new buys / sell if already held

  // --- balance sheet (total debt / equity) ---
  DEBT_EQUITY_MILD: 0.5,
  DEBT_EQUITY_MODERATE: 1.0,
  DEBT_EQUITY_WEAK: 2.0,         // above this -> "weak balance sheet": can never earn a strong-buy Lynch Score
  DEBT_SPIKE_DELTA: 0.5,         // jump of at least this much between refreshes -> "balance sheet risk spiking"
  GROWTH_DECEL_DROP_PP: 10,      // EPS growth falling by at least this many percentage points -> "decelerating sharply"

  // --- composite Lynch Score (0-100) thresholds ---
  LYNCH_BUY_SCORE: 70,
  LYNCH_ADD_SCORE: 78,
  LYNCH_TRIM_CEILING: 55,
  LYNCH_MOMENTUM_BREAKDOWN: -0.08,   // momentum this negative or worse = "sharp confirmed downtrend"
  LYNCH_DEVIATION_BREAKDOWN: -0.03,  // ...and price already below its short-term average -> gate new buys, wait for stabilization

  // --- position sizing by Lynch category (multiplies the existing vol-based target, still capped at MAX_POSITION_PCT) ---
  CATEGORY_ALLOCATION_MULT: {
    "Fast Grower": 1.25,
    "Stalwart": 1.0,
    "Slow Grower": 0.85,
    "Cyclical": 0.6,
    "Turnaround": 0.6,
    "ETF/Index": 1.0,
  },
  UNSUSTAINABLE_GROWTH_SIZE_MULT: 0.65,
};

// Sector/industry keywords (matched against Finnhub's company-profile
// `finnhubIndustry` field) whose earnings are classically tied to the
// economic cycle — Lynch's "Cyclical" bucket.
export const CYCLICAL_INDUSTRIES = [
  "auto", "airline", "industrial", "machinery", "metal", "mining",
  "materials", "chemical", "steel", "oil", "gas", "energy",
  "construction", "homebuilding", "shipping", "trucking", "semiconductor equipment",
];

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
