/* ==========================================================================
   COURSE TO COO — cloud sync
   Optional: if the user connects a Worker URL + sync key (see worker/), this
   pushes/pulls the whole app state to a tiny Cloudflare Worker so it follows
   them across devices, and exposes the calendar feed / widget script that
   read from the same backend. Entirely optional — with nothing configured,
   the app behaves exactly as it did with localStorage alone.

   Conflict handling is intentionally simple: whole-state last-write-wins,
   compared by state.updatedAt. Good enough for one person on a couple of
   devices; not a CRDT.
   ========================================================================== */

const SYNC_CONFIG_KEY = "coo-sync-config-v1";
const AUTO_PUSH_DELAY_MS = 1200;
const PERIODIC_PULL_MS = 60000;

let syncDebounceTimer = null;
let syncStatus = "idle"; // idle | syncing | error
let syncStatusMessage = "";

function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (!raw) return { workerUrl: "", syncKey: "", lastSyncedAt: null, lastError: null };
    return { workerUrl: "", syncKey: "", lastSyncedAt: null, lastError: null, ...JSON.parse(raw) };
  } catch {
    return { workerUrl: "", syncKey: "", lastSyncedAt: null, lastError: null };
  }
}

function saveSyncConfig(cfg) {
  try {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
  } catch (err) {
    console.error("Could not save sync settings.", err);
  }
}

function isSyncConfigured(cfg) {
  return !!(cfg && cfg.workerUrl && cfg.syncKey);
}

function workerBase(cfg) {
  return cfg.workerUrl.replace(/\/+$/, "");
}

/* ================================== NETWORK =================================== */

async function pullRemoteState(cfg) {
  const res = await fetch(`${workerBase(cfg)}/state`, {
    headers: { "X-Sync-Key": cfg.syncKey },
  });
  if (!res.ok) throw new Error(`Cloud returned ${res.status}`);
  return res.json();
}

async function pushLocalState(cfg) {
  const res = await fetch(`${workerBase(cfg)}/state`, {
    method: "PUT",
    headers: { "X-Sync-Key": cfg.syncKey, "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`Cloud returned ${res.status}`);
  return res.json();
}

function applyRemoteState(remote) {
  state.tasks = Array.isArray(remote.tasks) ? remote.tasks : [];
  state.settings = { ...state.settings, ...(remote.settings || {}) };
  state.updatedAt = remote.updatedAt || state.updatedAt;
  saveState(state);
  renderReadiness();
  applyTheme();
  switchView(currentView);
}

async function syncNow() {
  const cfg = loadSyncConfig();
  if (!isSyncConfigured(cfg)) return;

  setSyncStatus("syncing");
  try {
    const remote = await pullRemoteState(cfg);
    const remoteTime = remote && remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
    const localTime = state.updatedAt ? new Date(state.updatedAt).getTime() : 0;

    if (remoteTime > localTime) {
      applyRemoteState(remote);
      setSyncStatus("idle", "Pulled the newer copy from the cloud.");
    } else if (localTime > remoteTime) {
      await pushLocalState(cfg);
      setSyncStatus("idle", "Synced.");
    } else {
      setSyncStatus("idle", "Already in sync.");
    }
    const fresh = loadSyncConfig();
    fresh.lastSyncedAt = new Date().toISOString();
    fresh.lastError = null;
    saveSyncConfig(fresh);
  } catch (err) {
    setSyncStatus("error", err.message || "Sync failed.");
    const fresh = loadSyncConfig();
    fresh.lastError = err.message || "Sync failed.";
    saveSyncConfig(fresh);
  }
}

function scheduleAutoPush() {
  const cfg = loadSyncConfig();
  if (!isSyncConfigured(cfg)) return;
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    setSyncStatus("syncing");
    pushLocalState(cfg)
      .then(() => {
        const fresh = loadSyncConfig();
        fresh.lastSyncedAt = new Date().toISOString();
        fresh.lastError = null;
        saveSyncConfig(fresh);
        setSyncStatus("idle", "Synced.");
      })
      .catch((err) => {
        setSyncStatus("error", err.message || "Sync failed.");
        const fresh = loadSyncConfig();
        fresh.lastError = err.message || "Sync failed.";
        saveSyncConfig(fresh);
      });
  }, AUTO_PUSH_DELAY_MS);
}

function startPeriodicPull() {
  setInterval(() => {
    const cfg = loadSyncConfig();
    if (!isSyncConfigured(cfg) || syncStatus === "syncing") return;
    syncNow();
  }, PERIODIC_PULL_MS);
}

/* This is the hook app.js's persistAndRerender() calls after every local
   save, so cloud sync happens automatically without the rest of the app
   needing to know sync exists. */
function onStateMutated() {
  scheduleAutoPush();
}

/* ==================================== UI ======================================= */

function setSyncStatus(newStatus, message = "") {
  syncStatus = newStatus;
  syncStatusMessage = message;
  renderSyncStatus();
}

function calendarFeedUrl(cfg) {
  return `${workerBase(cfg)}/calendar.ics?key=${encodeURIComponent(cfg.syncKey)}`;
}

function renderSyncStatus() {
  const cfg = loadSyncConfig();
  const statusEl = document.getElementById("syncStatusText");
  if (!statusEl) return;

  if (!isSyncConfigured(cfg)) {
    statusEl.textContent = "Not connected";
    statusEl.className = "sync-status";
    document.getElementById("syncSetupFields").classList.remove("hidden");
    document.getElementById("syncConnectedFields").classList.add("hidden");
    return;
  }

  document.getElementById("syncSetupFields").classList.add("hidden");
  document.getElementById("syncConnectedFields").classList.remove("hidden");
  document.getElementById("syncWorkerDisplay").textContent = workerBase(cfg);

  const calUrl = calendarFeedUrl(cfg);
  document.getElementById("syncCalendarUrl").value = calUrl;
  document.getElementById("syncSubscribeLink").href = calUrl.replace(/^https?:/, "webcal:");

  if (syncStatus === "syncing") {
    statusEl.textContent = "Syncing…";
    statusEl.className = "sync-status syncing";
  } else if (syncStatus === "error") {
    statusEl.textContent = `Sync error: ${syncStatusMessage || cfg.lastError || "unknown"}`;
    statusEl.className = "sync-status error";
  } else {
    const when = cfg.lastSyncedAt ? formatDate(cfg.lastSyncedAt) : null;
    statusEl.textContent = when ? `Synced · last ${when}` : "Connected";
    statusEl.className = "sync-status ok";
  }
}

async function copyToClipboard(str) {
  try {
    await navigator.clipboard.writeText(str);
    return true;
  } catch {
    return false;
  }
}

async function copyWidgetScript() {
  const cfg = loadSyncConfig();
  if (!isSyncConfigured(cfg)) {
    alert("Connect to your Worker first, then copy the widget script.");
    return;
  }
  try {
    const res = await fetch("widget/scriptable-widget.js");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let text = await res.text();
    const appUrl = location.href.replace(/[^/]*$/, "");
    text = text
      .replace('"PASTE_YOUR_WORKER_URL_HERE"', JSON.stringify(workerBase(cfg)))
      .replace('"PASTE_YOUR_SYNC_KEY_HERE"', JSON.stringify(cfg.syncKey))
      .replace('"PASTE_YOUR_APP_URL_HERE"', JSON.stringify(appUrl));
    const ok = await copyToClipboard(text);
    alert(ok ? "Widget script copied! Paste it into a new script in the Scriptable app." : "Couldn't copy automatically — open widget/scriptable-widget.js in the repo and fill in the three constants by hand.");
  } catch (err) {
    alert("Couldn't fetch the widget script: " + err.message);
  }
}

function wireSyncUI() {
  document.getElementById("syncHowBtn").addEventListener("click", () => {
    document.getElementById("syncInstructions").classList.toggle("hidden");
  });

  document.getElementById("syncConnectBtn").addEventListener("click", () => {
    const workerUrl = document.getElementById("syncWorkerUrl").value.trim();
    const syncKey = document.getElementById("syncKeyInput").value.trim();
    if (!workerUrl || !syncKey) {
      alert("Enter both the Worker URL and your sync key.");
      return;
    }
    saveSyncConfig({ workerUrl, syncKey, lastSyncedAt: null, lastError: null });
    renderSyncStatus();
    syncNow();
  });

  document.getElementById("syncEditBtn").addEventListener("click", () => {
    const cfg = loadSyncConfig();
    document.getElementById("syncWorkerUrl").value = cfg.workerUrl;
    document.getElementById("syncKeyInput").value = cfg.syncKey;
    document.getElementById("syncSetupFields").classList.remove("hidden");
    document.getElementById("syncConnectedFields").classList.add("hidden");
  });

  document.getElementById("syncNowBtn").addEventListener("click", () => syncNow());

  document.getElementById("syncDisconnectBtn").addEventListener("click", () => {
    if (!confirm("Disconnect cloud sync? Your tasks stay on this device either way — this just stops syncing them anywhere else.")) return;
    saveSyncConfig({ workerUrl: "", syncKey: "", lastSyncedAt: null, lastError: null });
    renderSyncStatus();
  });

  document.getElementById("syncCopyCalendarBtn").addEventListener("click", async () => {
    const cfg = loadSyncConfig();
    if (!isSyncConfigured(cfg)) return;
    const ok = await copyToClipboard(calendarFeedUrl(cfg));
    alert(ok ? "Calendar link copied." : "Couldn't copy automatically — select the text in the field and copy it manually.");
  });

  document.getElementById("syncCopyWidgetBtn").addEventListener("click", copyWidgetScript);
}

function initSync() {
  wireSyncUI();
  renderSyncStatus();
  const cfg = loadSyncConfig();
  if (isSyncConfigured(cfg)) syncNow();
  startPeriodicPull();
}
