/* ==========================================================================
   AI INVESTMENT AGENT — dashboard (viewer only)
   --------------------------------------------------------------------------
   This page does NOT talk to Finnhub and does NOT make trading decisions.
   All of that happens server-side: a GitHub Actions workflow runs
   ai-investment-agent/agent/run.mjs on a schedule (see
   .github/workflows/ai-investment-agent.yml), which fetches real quotes and
   headlines, runs the trading engine (ai-investment-agent/agent/engine.mjs),
   and commits the result to data/state.json.

   This file's only job is to fetch that JSON and render it. That split
   matters for two reasons: the agent keeps running whether or not anyone
   has this page open (a real background agent, not "runs while your phone
   is awake"), and the Finnhub API key never has to sit in a public page's
   source — it's a GitHub Actions secret the browser never sees.

   File map:
     CONFIG        - viewer-only settings (where to fetch state from, how often)
     FORMATTING    - money/pct/share formatting helpers
     CHART         - dependency-free canvas line chart
     RENDERING     - DOM updates from the fetched state
     BOOTSTRAP     - fetch loop + settings-panel (info only) wiring
   ========================================================================== */

const CONFIG = {
  STATE_URL: "data/state.json",
  REFRESH_MS: 60 * 1000, // re-fetch the state file this often while the tab is open
};

let state = null;

/* ================================ FETCH ================================== */

async function fetchState() {
  // Cache-bust both the browser and any CDN in front of GitHub Pages so a
  // freshly-committed state.json shows up promptly instead of a stale copy.
  const url = `${CONFIG.STATE_URL}?t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load state.json: HTTP ${res.status}`);
  return res.json();
}

async function refresh() {
  try {
    state = await fetchState();
    setStatus(null);
  } catch (err) {
    setStatus(`Couldn't load the latest data (${err.message}). Showing the last successful load, if any.`);
    if (!state) return; // nothing to render yet
  }
  renderAll();
}

/* ============================== FORMATTING ================================ */

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

/** Formats a (possibly fractional) share count: more decimals for sub-share positions. */
function fmtShares(x) {
  if (x >= 100) return x.toFixed(1);
  if (x >= 1) return x.toFixed(3);
  return x.toFixed(4);
}

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

const CATEGORY_CLASS = {
  "Fast Grower": "cat-fast",
  "Stalwart": "cat-stalwart",
  "Slow Grower": "cat-slow",
  "Cyclical": "cat-cyclical",
  "Turnaround": "cat-turnaround",
  "ETF/Index": "cat-etf",
};

/** Small colored tag shown next to a ticker's name — empty string if there's no category yet. */
function categoryTag(fundamentals) {
  if (!fundamentals || !fundamentals.category) return "";
  const cls = CATEGORY_CLASS[fundamentals.category] || "cat-etf";
  return `<span class="category-tag ${cls}">${fundamentals.category}</span>`;
}

/* ================================ CHART ===================================
   Small dependency-free canvas line chart of the equity curve.
   ========================================================================== */

function drawChart() {
  const canvas = document.getElementById("equityChart");
  const parent = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = parent.clientWidth - 24;
  const cssHeight = canvas.clientHeight || 180;

  canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const points = state.history;
  if (!points || points.length < 2) return;

  const startingCash = state.config.startingCash;
  const values = points.map((p) => p.v);
  const minV = Math.min(...values, startingCash);
  const maxV = Math.max(...values, startingCash);
  const range = maxV - minV || 1;

  const padTop = 10, padBottom = 10, padLeft = 4, padRight = 4;
  const plotW = cssWidth - padLeft - padRight;
  const plotH = cssHeight - padTop - padBottom;

  const xAt = (i) => padLeft + (i / (points.length - 1)) * plotW;
  const yAt = (v) => padTop + plotH - ((v - minV) / range) * plotH;

  ctx.strokeStyle = "rgba(139,152,165,0.35)";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const baseY = yAt(startingCash);
  ctx.moveTo(padLeft, baseY);
  ctx.lineTo(cssWidth - padRight, baseY);
  ctx.stroke();
  ctx.setLineDash([]);

  const last = values[values.length - 1];
  const up = last >= values[0];
  const lineColor = up ? "#3ecf8e" : "#f2545b";

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

  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(values[0]));
  for (let i = 1; i < points.length; i++) ctx.lineTo(xAt(i), yAt(values[i]));
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/* ================================ RENDERING ================================ */

function renderHeader() {
  const equity = currentEquity();
  const startingCash = state.config.startingCash;

  const equityEl = document.getElementById("statEquity");
  equityEl.textContent = fmtMoney(equity);
  equityEl.className = `stat-value ${signClass(equity - startingCash)}`;

  const todayChange = equity - state.dayStartEquity;
  const todayPct = state.dayStartEquity ? todayChange / state.dayStartEquity : 0;
  const todayEl = document.getElementById("statToday");
  todayEl.textContent = `${fmtMoney(todayChange)} (${fmtPct(todayPct)})`;
  todayEl.className = `stat-value ${signClass(todayChange)}`;

  const totalReturn = startingCash ? (equity - startingCash) / startingCash : 0;
  const returnEl = document.getElementById("statReturn");
  returnEl.textContent = fmtPct(totalReturn);
  returnEl.className = `stat-value ${signClass(totalReturn)}`;

  const horizonEnd = state.startDate + state.config.horizonDays * 24 * 60 * 60 * 1000;
  const daysLeft = Math.max(0, Math.ceil((horizonEnd - Date.now()) / (24 * 60 * 60 * 1000)));
  document.getElementById("statDays").textContent = daysLeft;

  document.getElementById("goalLabel").textContent = `Goal: ${fmtMoney(state.config.goalEquity)}`;
  const goalRange = state.config.goalEquity - startingCash;
  const goalProgress = goalRange > 0 ? Math.max(0, Math.min(1, (equity - startingCash) / goalRange)) : 0;
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
      const signal = state.signals ? state.signals[ticker] : null;
      const tag = categoryTag(signal && signal.fundamentals);
      return `<tr>
        <td class="ticker-cell">${ticker}${tag}</td>
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
  const names = state.config.tickerNames || {};
  const watchlist = state.watchlist || [];

  // Sort by Lynch Score where we have one (real stocks), falling back to the
  // legacy momentum/reversion score for ETFs/indices — highest conviction first,
  // so the most attractive names are visible at a glance without scrolling.
  const sorted = [...watchlist].sort((a, b) => {
    const sa = state.signals ? state.signals[a] : null;
    const sb = state.signals ? state.signals[b] : null;
    const rankA = sa ? (sa.lynch ? sa.lynch.lynchScore : sa.score * 100) : -Infinity;
    const rankB = sb ? (sb.lynch ? sb.lynch.lynchScore : sb.score * 100) : -Infinity;
    return rankB - rankA;
  });

  tbody.innerHTML = sorted.map((ticker) => {
    const signal = state.signals ? state.signals[ticker] : null;
    const price = latestPrice(ticker);
    const name = names[ticker] || "";
    const tag = categoryTag(signal && signal.fundamentals);

    if (!signal) {
      const priceCell = price ? fmtMoney(price) : "—";
      return `<tr>
        <td class="ticker-cell">${ticker}<span class="ticker-name">${name}</span>${tag}</td>
        <td>${priceCell}</td>
        <td colspan="4" class="neutral">warming up…</td>
        <td><span class="signal-badge signal-hold">HOLD</span></td>
      </tr>`;
    }

    const f = signal.fundamentals;
    const hasLynch = f && f.category && f.category !== "ETF/Index" && f.lynchScore !== undefined;

    let badgeClass = "signal-hold", badgeText = "HOLD";
    if (hasLynch) {
      if (signal.lynch && signal.lynch.lynchScore >= state.config.lynchBuyScore && !signal.lynch.weakBalanceSheet && !signal.lynch.sharpDowntrend) {
        badgeClass = "signal-buy"; badgeText = "BUY";
      } else if (f.peg !== null && f.peg !== undefined && f.peg > state.config.pegSell) {
        badgeClass = "signal-sell"; badgeText = "SELL";
      }
    } else {
      if (signal.score >= state.config.buyThreshold) { badgeClass = "signal-buy"; badgeText = "BUY"; }
      else if (signal.score <= state.config.sellThreshold) { badgeClass = "signal-sell"; badgeText = "SELL"; }
    }

    const pegCell = hasLynch ? (f.peg === null ? "n/a" : f.peg.toFixed(2)) : "—";
    const growthCell = hasLynch && f.growthPct !== null ? fmtPct(f.growthPct / 100) : "—";
    const debtCell = hasLynch && f.debtEquity !== null && f.debtEquity !== undefined ? f.debtEquity.toFixed(2) : "—";
    const lynchCell = hasLynch ? Math.round(f.lynchScore) : "—";
    const rowClass = hasLynch && f.lynchScore >= state.config.lynchBuyScore ? "watchlist-hot" : "";

    return `<tr class="${rowClass}">
      <td class="ticker-cell">${ticker}<span class="ticker-name">${name}</span>${tag}</td>
      <td>${fmtMoney(signal.current)}</td>
      <td>${pegCell}</td>
      <td>${growthCell}</td>
      <td>${debtCell}</td>
      <td>${lynchCell}</td>
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

function setStatus(message) {
  const banner = document.getElementById("statusBanner");
  if (!message) {
    banner.classList.add("hidden");
    return;
  }
  banner.textContent = message;
  banner.className = "status-banner error";
  banner.classList.remove("hidden");
}

function renderFooter() {
  const el = document.getElementById("lastUpdated");
  if (!state.lastPriceUpdate) {
    el.textContent = "Waiting for the first agent run…";
  } else {
    el.textContent = `Agent last ran: ${new Date(state.lastPriceUpdate).toLocaleString()}`;
  }
}

function renderAll() {
  if (!state) return;
  renderHeader();
  renderHoldings();
  renderWatchlist();
  renderJournal();
  renderFooter();
  drawChart();
}

/* ============================ EVENT HANDLERS ==============================
   The Settings panel is informational now: the agent's config (watchlist,
   API key) lives server-side in agent/config.mjs and a GitHub Actions
   secret, not in this browser, so there's nothing to edit here.
   ========================================================================== */

function openSettings() {
  document.getElementById("settingsWatchlist").textContent = (state && state.watchlist || []).join(", ") || "—";
  document.getElementById("settingsOverlay").classList.remove("hidden");
}

function closeSettings() {
  document.getElementById("settingsOverlay").classList.add("hidden");
}

function wireEvents() {
  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("closeSettingsBtn").addEventListener("click", closeSettings);
  document.getElementById("settingsOverlay").addEventListener("click", (e) => {
    if (e.target.id === "settingsOverlay") closeSettings();
  });
  window.addEventListener("resize", () => state && drawChart());
}

function init() {
  wireEvents();
  refresh();
  setInterval(refresh, CONFIG.REFRESH_MS);
}

document.addEventListener("DOMContentLoaded", init);
