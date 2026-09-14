/* ==========================================================================
   STORAGE — persistence to localStorage. Saves on every mutation, no manual
   save step. Single source of truth key; a tiny version field leaves room
   for a future migration without losing data.
   ========================================================================== */

const STORAGE_KEY = "coo-task-planner-v1";

function defaultState() {
  const weights = {};
  PILLARS.forEach((p) => (weights[p.id] = 1));
  return {
    version: 1,
    tasks: [],
    settings: {
      pillarWeights: weights,
    },
  };
}

function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn("localStorage unavailable, starting with a fresh in-memory state", err);
    return defaultState();
  }
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  } catch (err) {
    console.error("Saved data was unreadable, starting fresh.", err);
    return defaultState();
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Could not save — your changes may not persist.", err);
  }
}
