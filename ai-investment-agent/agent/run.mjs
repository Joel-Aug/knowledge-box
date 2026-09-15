#!/usr/bin/env node
// ==========================================================================
// AI INVESTMENT AGENT — background runner
// --------------------------------------------------------------------------
// Invoked by .github/workflows/agent.yml on a schedule (and manually via
// workflow_dispatch). Talks to Finnhub for real quotes/headlines, runs the
// deterministic trading engine in engine.mjs, and writes the result to
// data/state.json. The workflow then commits that file — that's the only
// way the front-end (app.js) ever sees new data; app.js has no Finnhub
// access of its own.
//
// Requires the FINNHUB_API_KEY environment variable (set from the
// repository's FINNHUB_API_KEY Actions secret — never committed to a file).
// Set RESET=true to wipe the simulation back to a fresh starting state
// instead of running a normal cycle (used by the workflow's `reset` input).
// ==========================================================================
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { CONFIG } from "./config.mjs";
import {
  defaultState,
  computeSignals,
  updateGlobalSentiment,
  updateTickerMentions,
  runTradingEngine,
  recalcPortfolio,
  buildFundamentalsRecord,
} from "./engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "..", "data", "state.json");
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const QUOTE_STAGGER_MS = 250;

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchQuote(ticker) {
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Quote fetch failed for ${ticker}: HTTP ${res.status}`);
  const data = await res.json();
  if (data && data.c === 0 && data.pc === 0) {
    throw new Error(`No quote data for ${ticker} (unknown symbol or rate-limited)`);
  }
  return data;
}

// Finnhub's /stock/metric response uses a few different field names across
// plan tiers/history for the same underlying number — try each in order and
// use the first one that's actually present as a finite number.
const EPS_GROWTH_TTM_KEYS = ["epsGrowthTTMYoy", "epsGrowthQuarterlyYoy", "epsGrowth3Y", "epsGrowth5Y"];
const EPS_GROWTH_RECENT_KEYS = ["epsGrowthQuarterlyYoy", "epsGrowthTTMYoy"];
const PE_KEYS = ["peExclExtraTTM", "peBasicExclExtraTTM", "peNormalizedAnnual", "peInclExtraTTM", "peTTM"];
const DEBT_EQUITY_KEYS = ["totalDebt/totalEquityQuarterly", "totalDebt/totalEquityAnnual", "longTermDebt/equityQuarterly"];
const FCF_KEYS = ["pfcfShareTTM"]; // price/FCF-per-share proxy — Finnhub's free tier has no raw FCF dollar figure

function pickFirstNumber(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && isFinite(v)) return v;
  }
  return null;
}

/**
 * Fetches the slow-moving fundamentals Finnhub has for one ticker: EPS
 * growth, P/E, debt/equity (via /stock/metric) and its industry (via
 * /stock/profile2, used to flag classically cyclical sectors). ETFs/indices
 * return no usable EPS growth here — that's expected, and engine.mjs's
 * buildFundamentalsRecord treats it as "ETF/Index" and falls back to the
 * existing momentum/mean-reversion scoring for that ticker.
 */
async function fetchFundamentals(ticker) {
  const metricUrl = `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${FINNHUB_API_KEY}`;
  const metricRes = await fetch(metricUrl);
  if (!metricRes.ok) throw new Error(`Fundamentals fetch failed for ${ticker}: HTTP ${metricRes.status}`);
  const metricData = await metricRes.json();
  const metric = (metricData && metricData.metric) || {};

  await delay(QUOTE_STAGGER_MS);
  const profileUrl = `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_API_KEY}`;
  const profileRes = await fetch(profileUrl);
  const profile = profileRes.ok ? await profileRes.json() : {};

  const epsGrowthRaw = pickFirstNumber(metric, EPS_GROWTH_TTM_KEYS);
  const epsGrowthRecentRaw = pickFirstNumber(metric, EPS_GROWTH_RECENT_KEYS);

  return {
    // Finnhub reports growth metrics as whole-number percentages (24.5 == 24.5%)
    // — normalize to a decimal fraction so the rest of the engine works in one unit.
    epsGrowth: epsGrowthRaw === null ? null : epsGrowthRaw / 100,
    epsGrowthRecent: epsGrowthRecentRaw === null ? null : epsGrowthRecentRaw / 100,
    pe: pickFirstNumber(metric, PE_KEYS),
    debtEquity: pickFirstNumber(metric, DEBT_EQUITY_KEYS),
    fcfProxy: pickFirstNumber(metric, FCF_KEYS),
    marketCap: typeof metric.marketCapitalization === "number" ? metric.marketCapitalization : null,
    industry: profile && profile.finnhubIndustry ? profile.finnhubIndustry : null,
  };
}

async function fetchNews() {
  const url = `${FINNHUB_BASE}/news?category=general&token=${FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`News fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data.slice(0, 40) : [];
}

async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(CONFIG), parsed);
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("Could not parse existing state.json, starting fresh:", err.message);
    return defaultState(CONFIG);
  }
}

async function saveState(state) {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

async function main() {
  if (!FINNHUB_API_KEY) {
    console.error(
      "FINNHUB_API_KEY is not set. Add it as a repository secret " +
      "(Settings -> Secrets and variables -> Actions -> New repository secret) " +
      "so the workflow can pass it in as an environment variable."
    );
    process.exit(1);
  }

  if (process.env.RESET === "true") {
    const fresh = defaultState(CONFIG);
    await saveState(fresh);
    console.log("Simulation reset to a fresh state.");
    return;
  }

  const state = await loadState();
  const now = Date.now();

  let sawError = null;
  for (let i = 0; i < CONFIG.WATCHLIST.length; i++) {
    const ticker = CONFIG.WATCHLIST[i];
    if (i > 0) await delay(QUOTE_STAGGER_MS);
    try {
      const quote = await fetchQuote(ticker);
      const hist = state.priceHistory[ticker] || (state.priceHistory[ticker] = []);
      hist.push({ t: now, p: quote.c });
      if (hist.length > CONFIG.MAX_HISTORY_POINTS) {
        state.priceHistory[ticker] = hist.slice(-CONFIG.MAX_HISTORY_POINTS);
      }
    } catch (err) {
      sawError = err.message;
      console.warn(err.message);
    }
  }

  try {
    const headlines = await fetchNews();
    updateGlobalSentiment(state, headlines);
    updateTickerMentions(state, CONFIG, headlines);
  } catch (err) {
    console.warn("News refresh failed:", err.message);
  }

  // Fundamentals (EPS growth, P/E, debt/equity) move on a quarterly cadence,
  // so most runs skip this entirely — only a ticker whose cache has aged
  // past FUNDAMENTALS_REFRESH_MS actually costs an API call here.
  let fundamentalsRefreshed = 0;
  for (const ticker of CONFIG.WATCHLIST) {
    const cached = state.fundamentals[ticker];
    const stale = !cached || now - cached.updatedAt >= CONFIG.FUNDAMENTALS_REFRESH_MS;
    if (!stale) continue;
    if (fundamentalsRefreshed > 0) await delay(QUOTE_STAGGER_MS);
    try {
      const raw = await fetchFundamentals(ticker);
      state.fundamentals[ticker] = buildFundamentalsRecord(CONFIG, state.priceHistory[ticker], cached, raw, now);
      fundamentalsRefreshed++;
    } catch (err) {
      sawError = sawError || err.message;
      console.warn(err.message);
    }
  }

  state.lastFetchError = sawError;

  const journalCountBefore = state.journal.length;
  runTradingEngine(state, CONFIG, now);
  recalcPortfolio(state, CONFIG, now);

  const tradesThisRun = state.journal.length - journalCountBefore;
  console.log(
    `Run complete. Equity: $${state.cash.toFixed(2)} cash + positions. ` +
    `Trades this run: ${tradesThisRun}. Tickers with history: ` +
    `${Object.values(state.priceHistory).filter((h) => h.length >= CONFIG.SMA_LOOKBACK).length}/${CONFIG.WATCHLIST.length} warmed up. ` +
    `Fundamentals refreshed: ${fundamentalsRefreshed}.`
  );

  await saveState(state);
}

main().catch((err) => {
  console.error("Agent run failed:", err);
  process.exit(1);
});
