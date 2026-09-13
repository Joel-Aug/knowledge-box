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

  state.lastFetchError = sawError;

  const journalCountBefore = state.journal.length;
  runTradingEngine(state, CONFIG, now);
  recalcPortfolio(state, CONFIG, now);

  const tradesThisRun = state.journal.length - journalCountBefore;
  console.log(
    `Run complete. Equity: $${state.cash.toFixed(2)} cash + positions. ` +
    `Trades this run: ${tradesThisRun}. Tickers with history: ` +
    `${Object.values(state.priceHistory).filter((h) => h.length >= CONFIG.SMA_LOOKBACK).length}/${CONFIG.WATCHLIST.length} warmed up.`
  );

  await saveState(state);
}

main().catch((err) => {
  console.error("Agent run failed:", err);
  process.exit(1);
});
