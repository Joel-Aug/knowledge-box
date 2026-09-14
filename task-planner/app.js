/* ==========================================================================
   COURSE TO COO — app logic
   No build step, no framework: plain DOM rendering driven by a single state
   object that's saved to localStorage after every mutation (see storage.js).
   File map:
     STATE & UTILS     - in-memory state, id/date/escape helpers
     TASK ACTIONS      - create/update/complete/delete + persistAndRerender
     PILLAR MATH        - progress per pillar, per focus-area, overall readiness
     TODAY / TRIAGE VIEW
     LISTS VIEW
     HISTORY VIEW
     ROADMAP VIEW        - hub-and-spoke svg + pillar detail cards + weights
     TASK EDITOR MODAL
     CELEBRATION
     WIRING / INIT
   ========================================================================== */

/* ================================= STATE ================================== */

const state = loadState();

let currentView = "today";
let listsTerm = "short";
let historyTerm = "all";
let editingId = null;
let celebrateTimer = null;

function uid() {
  return "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function pillarOptionsHtml() {
  return PILLARS.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
}

function focusOptionsHtml(pillarId) {
  const pillar = PILLAR_BY_ID[pillarId] || PILLARS[0];
  return (
    `<option value="">&mdash; none &mdash;</option>` +
    pillar.focusAreas.map((fa) => `<option value="${escapeHtml(fa)}">${escapeHtml(fa)}</option>`).join("")
  );
}

/* ============================== TASK ACTIONS =============================== */

function createTask({ title, notes, quadrant, term, pillarId, focusArea }) {
  const task = {
    id: uid(),
    title,
    notes: notes || "",
    quadrant,
    term,
    pillarId: term === "long" ? pillarId || null : null,
    focusArea: term === "long" ? focusArea || null : null,
    status: "open",
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  state.tasks.push(task);
  persistAndRerender();
  return task;
}

function updateTask(id, patch) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  if (t.term !== "long") {
    t.pillarId = null;
    t.focusArea = null;
  }
  persistAndRerender();
}

function toggleTaskComplete(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.status === "completed") {
    t.status = "open";
    t.completedAt = null;
  } else {
    t.status = "completed";
    t.completedAt = new Date().toISOString();
    if (t.term === "long" && t.pillarId) {
      const pillar = PILLAR_BY_ID[t.pillarId];
      const stats = pillarStats(t.pillarId);
      celebrate(pillar, stats.percent, t.title);
    }
  }
  persistAndRerender();
}

function deleteTask(id) {
  if (!confirm("Delete this task? This can't be undone.")) return;
  state.tasks = state.tasks.filter((x) => x.id !== id);
  closeModal();
  persistAndRerender();
}

function persistAndRerender() {
  saveState(state);
  renderReadiness();
  if (currentView === "today") renderToday();
  else if (currentView === "lists") renderLists();
  else if (currentView === "history") renderHistory();
  else if (currentView === "roadmap") renderRoadmap();
}

/* =============================== PILLAR MATH ================================ */

function pillarStats(pillarId) {
  const tasks = state.tasks.filter((t) => t.term === "long" && t.pillarId === pillarId);
  const completed = tasks.filter((t) => t.status === "completed");
  const percent = tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0;
  const pillar = PILLAR_BY_ID[pillarId];
  const focusBreakdown = pillar.focusAreas.map((fa) => {
    const faTasks = tasks.filter((t) => t.focusArea === fa);
    const faCompleted = faTasks.filter((t) => t.status === "completed");
    return { focusArea: fa, total: faTasks.length, completed: faCompleted.length };
  });
  return { tasks, completed, percent, focusBreakdown };
}

function overallReadiness() {
  const weights = state.settings.pillarWeights;
  let sumW = 0, sumWP = 0;
  PILLARS.forEach((p) => {
    const w = weights[p.id] ?? 1;
    sumW += w;
    sumWP += w * pillarStats(p.id).percent;
  });
  return sumW ? Math.round(sumWP / sumW) : 0;
}

const READINESS_CIRCUMFERENCE = 2 * Math.PI * 27;

function renderReadiness() {
  const pct = overallReadiness();
  document.getElementById("readinessPct").textContent = pct + "%";
  document.getElementById("readinessRingFill").style.strokeDashoffset =
    READINESS_CIRCUMFERENCE * (1 - pct / 100);
}

/* ============================= SHARED TASK CARD ============================== */

function taskCardHtml(t, opts = {}) {
  const isDone = t.status === "completed";
  const pillar = t.pillarId ? PILLAR_BY_ID[t.pillarId] : null;
  return `
    <div class="task-card" data-task-id="${t.id}">
      <button type="button" class="task-check ${isDone ? "checked" : ""}" data-action="toggle"
        aria-label="${isDone ? "Mark open" : "Mark complete"}"></button>
      <div class="task-body" data-action="edit">
        <div class="task-title ${isDone ? "done" : ""}">${escapeHtml(t.title)}</div>
        ${t.notes ? `<div class="task-notes">${escapeHtml(t.notes)}</div>` : ""}
        <div class="task-badges">
          <span class="badge badge-term-${t.term}">${t.term === "long" ? "Long" : "Short"}</span>
          ${opts.showQuadrant ? `<span class="badge badge-quadrant-${t.quadrant}">${QUADRANT_BY_ID[t.quadrant].verb}</span>` : ""}
          ${pillar ? `<span class="badge">${escapeHtml(pillar.short)}</span>` : ""}
          ${t.focusArea ? `<span class="badge">${escapeHtml(t.focusArea)}</span>` : ""}
          ${isDone ? `<span class="badge badge-date">done ${formatDate(t.completedAt)}</span>` : ""}
        </div>
      </div>
      <button type="button" class="task-edit-btn" data-action="edit" aria-label="Edit task">&#9998;</button>
    </div>`;
}

/* ============================ TODAY / TRIAGE VIEW ============================ */

function renderToday() {
  const grid = document.getElementById("quadrantGrid");
  grid.innerHTML = QUADRANTS.map((q) => quadrantHtml(q)).join("");
}

function quadrantHtml(q) {
  const tasks = state.tasks.filter((t) => t.quadrant === q.id && t.status === "open");
  return `
    <div class="quadrant" data-quadrant="${q.id}">
      <div class="quadrant-head">
        <div>
          <div class="quadrant-verb">${q.verb}</div>
          <div class="quadrant-sub">${q.label}</div>
        </div>
        <span class="quadrant-count">${tasks.length}</span>
      </div>
      <form class="quick-add" data-quadrant="${q.id}">
        <input type="text" class="quick-add-title" placeholder="Add a task&hellip;" required maxlength="200" />
        <div class="quick-add-term">
          <button type="button" class="chip-toggle active" data-term="short">Short</button>
          <button type="button" class="chip-toggle" data-term="long">Long</button>
        </div>
        <div class="quick-add-long-fields hidden">
          <select class="quick-add-pillar">${pillarOptionsHtml()}</select>
          <select class="quick-add-focus">${focusOptionsHtml(PILLARS[0].id)}</select>
        </div>
        <button type="submit" class="quick-add-submit">Add</button>
      </form>
      <div class="task-list">
        ${tasks.length ? tasks.map((t) => taskCardHtml(t, { showQuadrant: false })).join("") : `<div class="task-empty">Nothing here. Good.</div>`}
      </div>
    </div>`;
}

function onQuadrantGridClick(e) {
  const chip = e.target.closest(".chip-toggle");
  if (!chip) return;
  e.preventDefault();
  const form = chip.closest(".quick-add");
  form.querySelectorAll(".chip-toggle").forEach((c) => c.classList.toggle("active", c === chip));
  form.querySelector(".quick-add-long-fields").classList.toggle("hidden", chip.dataset.term !== "long");
}

function onQuadrantGridChange(e) {
  if (!e.target.classList.contains("quick-add-pillar")) return;
  const form = e.target.closest(".quick-add");
  form.querySelector(".quick-add-focus").innerHTML = focusOptionsHtml(e.target.value);
}

function onQuadrantGridSubmit(e) {
  const form = e.target;
  if (!form.classList.contains("quick-add")) return;
  e.preventDefault();
  const title = form.querySelector(".quick-add-title").value.trim();
  if (!title) return;
  const term = form.querySelector(".chip-toggle.active")?.dataset.term || "short";
  const quadrant = form.dataset.quadrant;
  const pillarId = term === "long" ? form.querySelector(".quick-add-pillar").value : null;
  const focusArea = term === "long" ? form.querySelector(".quick-add-focus").value || null : null;
  createTask({ title, notes: "", quadrant, term, pillarId, focusArea });
}

/* ================================ LISTS VIEW ================================= */

function renderLists() {
  document.querySelectorAll("#listsTermToggle .segmented-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.term === listsTerm)
  );
  document.getElementById("listsHint").textContent =
    listsTerm === "short"
      ? "Open short-run tasks — your working list for the next few days."
      : "Open long-run tasks — steps toward the roadmap.";

  const tasks = state.tasks.filter((t) => t.term === listsTerm && t.status === "open");
  const content = document.getElementById("listsContent");
  if (!tasks.length) {
    content.innerHTML = `<div class="task-empty">Nothing open here.</div>`;
    return;
  }
  content.innerHTML = QUADRANTS.map((q) => {
    const qTasks = tasks.filter((t) => t.quadrant === q.id);
    if (!qTasks.length) return "";
    return `
      <div class="list-group">
        <p class="list-group-title">${q.verb} &middot; ${q.label}</p>
        <div class="task-list">${qTasks.map((t) => taskCardHtml(t, { showQuadrant: false })).join("")}</div>
      </div>`;
  }).join("");
}

/* =============================== HISTORY VIEW ================================ */

function historyRowHtml(t) {
  const q = QUADRANT_BY_ID[t.quadrant];
  const pillar = t.pillarId ? PILLAR_BY_ID[t.pillarId] : null;
  return `
    <div class="history-row" data-task-id="${t.id}">
      <span class="history-mark" data-action="toggle" role="button" tabindex="0" title="Reopen">&#10004;</span>
      <div class="task-body" data-action="edit">
        <div class="task-title">${escapeHtml(t.title)}</div>
        ${t.notes ? `<div class="task-notes">${escapeHtml(t.notes)}</div>` : ""}
        <div class="task-badges">
          <span class="badge badge-term-${t.term}">${t.term === "long" ? "Long" : "Short"}</span>
          <span class="badge badge-quadrant-${t.quadrant}">${q.verb}</span>
          ${pillar ? `<span class="badge">${escapeHtml(pillar.short)}</span>` : ""}
          ${t.focusArea ? `<span class="badge">${escapeHtml(t.focusArea)}</span>` : ""}
          <span class="badge badge-date">completed ${formatDate(t.completedAt)}</span>
        </div>
      </div>
    </div>`;
}

function renderHistory() {
  document.querySelectorAll("#historyTermToggle .segmented-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.term === historyTerm)
  );
  let tasks = state.tasks.filter((t) => t.status === "completed");
  if (historyTerm !== "all") tasks = tasks.filter((t) => t.term === historyTerm);
  tasks = tasks.slice().sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  const content = document.getElementById("historyContent");
  content.innerHTML = tasks.length
    ? tasks.map(historyRowHtml).join("")
    : `<div class="task-empty">No completed tasks yet.</div>`;
}

/* ================================ ROADMAP VIEW ================================ */

function buildRoadmapSvg() {
  const cx = 200, cy = 200, hubR = 52, nodeR = 30, orbit = 148;
  const overall = overallReadiness();

  const nodesSvg = PILLARS.map((p, i) => {
    const angle = ((-90 + i * 60) * Math.PI) / 180;
    const nx = cx + orbit * Math.cos(angle);
    const ny = cy + orbit * Math.sin(angle);
    const pct = pillarStats(p.id).percent;

    const dx = cx - nx, dy = cy - ny;
    const dist = Math.hypot(dx, dy);
    const ux = dx / dist, uy = dy / dist;
    const x1 = nx + ux * nodeR, y1 = ny + uy * nodeR;
    const x2 = cx - ux * hubR, y2 = cy - uy * hubR;
    const lineLen = Math.hypot(x2 - x1, y2 - y1);
    const lineOffset = lineLen * (1 - pct / 100);

    const ringR = nodeR - 4;
    const ringC = 2 * Math.PI * ringR;
    const ringOffset = ringC * (1 - pct / 100);

    return `
      <g>
        <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="spoke-line" />
        <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="spoke-line-fill"
          stroke-dasharray="${lineLen.toFixed(1)}" stroke-dashoffset="${lineOffset.toFixed(1)}" />
        <circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${ringR}" class="pillar-node-ring-track" />
        <circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${ringR}" class="pillar-node-ring-fill"
          stroke-dasharray="${ringC.toFixed(1)}" stroke-dashoffset="${ringOffset.toFixed(1)}"
          transform="rotate(-90 ${nx.toFixed(1)} ${ny.toFixed(1)})" />
        <circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${nodeR - 8}" class="pillar-node-disc" data-goto-pillar="${p.id}" />
        <text x="${nx.toFixed(1)}" y="${(ny - 3).toFixed(1)}" class="pillar-node-label" data-goto-pillar="${p.id}">${escapeHtml(p.short)}</text>
        <text x="${nx.toFixed(1)}" y="${(ny + 9).toFixed(1)}" class="pillar-node-pct" data-goto-pillar="${p.id}">${pct}%</text>
      </g>`;
  }).join("");

  return `
    <svg viewBox="0 0 400 400" role="img" aria-label="Six pillars converging on becoming COO of C-Pharma, ${overall} percent overall">
      ${nodesSvg}
      <circle cx="${cx}" cy="${cy}" r="${hubR}" fill="var(--ink-panel)" stroke="var(--brass)" stroke-width="1.5" />
      <text x="${cx}" y="${cy - 16}" text-anchor="middle" class="hub-center-label" font-size="6.5" letter-spacing="1">COO READINESS</text>
      <text x="${cx}" y="${cy + 10}" text-anchor="middle" class="hub-center-pct" font-size="24">${overall}%</text>
      <text x="${cx}" y="${cy + 24}" text-anchor="middle" class="hub-center-label" font-size="6" fill="var(--parchment-dim)">${escapeHtml(FINAL_OBJECTIVE)}</text>
    </svg>`;
}

function pillarCardHtml(p) {
  const stats = pillarStats(p.id);
  const orderedTasks = [
    ...stats.tasks.filter((t) => t.status === "open"),
    ...stats.tasks.filter((t) => t.status === "completed"),
  ];
  const focusTagsHtml = stats.focusBreakdown
    .map((fb) => {
      const cls = fb.total === 0 ? "focus-tag zero" : fb.completed === fb.total ? "focus-tag active" : "focus-tag";
      const label = fb.total === 0 ? fb.focusArea : `${fb.focusArea} (${fb.completed}/${fb.total})`;
      return `<span class="${cls}">${escapeHtml(label)}</span>`;
    })
    .join("");

  return `
    <div class="pillar-card" data-pillar="${p.id}">
      <div class="pillar-card-head">
        <h3 class="pillar-card-name">${escapeHtml(p.name)}</h3>
        <span class="pillar-card-pct">${stats.percent}%</span>
      </div>
      <p class="pillar-card-blurb">${escapeHtml(p.blurb)}</p>
      <div class="pillar-progress-track"><div class="pillar-progress-fill" style="width:${stats.percent}%"></div></div>
      <div class="focus-tags">${focusTagsHtml}</div>
      <div class="pillar-card-tasks">
        ${orderedTasks.length ? orderedTasks.map((t) => taskCardHtml(t, { showQuadrant: true })).join("") : `<div class="task-empty">No long-run tasks attached yet.</div>`}
      </div>
      <form class="quick-add pillar-card-add" data-quadrant="inu" data-pillar-add="${p.id}">
        <input type="text" class="quick-add-title" placeholder="Add a task toward this pillar&hellip;" required maxlength="200" />
        <select class="quick-add-focus">${focusOptionsHtml(p.id)}</select>
        <button type="submit" class="quick-add-submit">Add</button>
      </form>
    </div>`;
}

function renderPillarCards() {
  document.getElementById("pillarCards").innerHTML = PILLARS.map(pillarCardHtml).join("");
}

function renderWeightsPanel() {
  document.getElementById("weightsPanel").innerHTML = PILLARS.map((p) => {
    const w = state.settings.pillarWeights[p.id] ?? 1;
    return `
      <div class="weight-row">
        <span>${escapeHtml(p.short)}</span>
        <input type="range" min="0" max="3" step="0.5" value="${w}" data-weight="${p.id}" />
        <span data-weight-value>${w}&times;</span>
      </div>`;
  }).join("");
}

function renderRoadmap() {
  document.getElementById("roadmapSvgWrap").innerHTML = buildRoadmapSvg();
  renderWeightsPanel();
  renderPillarCards();
}

function onPillarCardsSubmit(e) {
  const form = e.target;
  if (!form.classList.contains("quick-add") || !form.dataset.pillarAdd) return;
  e.preventDefault();
  const title = form.querySelector(".quick-add-title").value.trim();
  if (!title) return;
  const focusArea = form.querySelector(".quick-add-focus").value || null;
  createTask({
    title,
    notes: "",
    quadrant: form.dataset.quadrant,
    term: "long",
    pillarId: form.dataset.pillarAdd,
    focusArea,
  });
}

function onRoadmapSvgClick(e) {
  const el = e.target.closest("[data-goto-pillar]");
  if (!el) return;
  const card = document.querySelector(`.pillar-card[data-pillar="${el.dataset.gotoPillar}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  flashPillarCard(card);
}

function onWeightsPanelInput(e) {
  const input = e.target.closest("input[data-weight]");
  if (!input) return;
  state.settings.pillarWeights[input.dataset.weight] = parseFloat(input.value);
  input.parentElement.querySelector("[data-weight-value]").textContent = `${input.value}×`;
  saveState(state);
  renderReadiness();
  document.getElementById("roadmapSvgWrap").innerHTML = buildRoadmapSvg();
}

/* ============================== TASK EDITOR MODAL ============================= */

const modalOverlay = document.getElementById("taskModalOverlay");
const taskForm = document.getElementById("taskForm");
const fieldTitle = document.getElementById("fieldTitle");
const fieldNotes = document.getElementById("fieldNotes");
const fieldQuadrant = document.getElementById("fieldQuadrant");
const fieldTermWrap = document.getElementById("fieldTerm");
const fieldPillarWrap = document.getElementById("fieldPillarWrap");
const fieldPillar = document.getElementById("fieldPillar");
const fieldFocusWrap = document.getElementById("fieldFocusWrap");
const fieldFocus = document.getElementById("fieldFocus");
const taskDeleteBtn = document.getElementById("taskDeleteBtn");

fieldQuadrant.innerHTML = QUADRANTS.map(
  (q) => `<button type="button" class="pill-option" data-quadrant="${q.id}">${q.verb}</button>`
).join("");
fieldPillar.innerHTML = pillarOptionsHtml();

function toggleLongFields(show) {
  fieldPillarWrap.classList.toggle("hidden", !show);
  fieldFocusWrap.classList.toggle("hidden", !show);
}

function openEditor(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  fieldTitle.value = t.title;
  fieldNotes.value = t.notes || "";
  fieldQuadrant.querySelectorAll(".pill-option").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.quadrant === t.quadrant)
  );
  fieldTermWrap.querySelectorAll(".segmented-btn").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.term === t.term)
  );
  toggleLongFields(t.term === "long");
  fieldPillar.value = t.pillarId || PILLARS[0].id;
  fieldFocus.innerHTML = focusOptionsHtml(fieldPillar.value);
  fieldFocus.value = t.focusArea || "";
  taskDeleteBtn.classList.remove("hidden");
  document.getElementById("taskModalTitle").textContent = "Edit task";
  modalOverlay.classList.remove("hidden");
  fieldTitle.focus();
}

function closeModal() {
  modalOverlay.classList.add("hidden");
  editingId = null;
}

function onTaskFormSubmit(e) {
  e.preventDefault();
  const title = fieldTitle.value.trim();
  if (!title || !editingId) return;
  const quadrant = fieldQuadrant.querySelector(".pill-option.active")?.dataset.quadrant || "ui";
  const term = fieldTermWrap.querySelector(".segmented-btn.active")?.dataset.term || "short";
  const pillarId = term === "long" ? fieldPillar.value : null;
  const focusArea = term === "long" ? fieldFocus.value || null : null;
  updateTask(editingId, { title, notes: fieldNotes.value.trim(), quadrant, term, pillarId, focusArea });
  closeModal();
}

/* ================================ CELEBRATION ================================= */

function flashPillarCard(card) {
  card.classList.remove("flash");
  void card.offsetWidth;
  card.classList.add("flash");
}

function celebrate(pillar, percent, taskTitle) {
  const el = document.getElementById("celebration");
  document.getElementById("celebrationTitle").textContent = `Logged toward ${pillar.name}`;
  document.getElementById("celebrationDetail").textContent = `"${taskTitle}" done — pillar now ${percent}%.`;
  el.classList.remove("hidden");
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.classList.add("hidden"), 400);
  }, 3200);

  const card = document.querySelector(`.pillar-card[data-pillar="${pillar.id}"]`);
  if (card) flashPillarCard(card);
}

/* ================================= VIEW SWITCH ================================= */

function switchView(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  document.getElementById(`view-${view}`).classList.remove("hidden");
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));

  if (view === "today") renderToday();
  else if (view === "roadmap") renderRoadmap();
  else if (view === "lists") renderLists();
  else if (view === "history") renderHistory();
}

/* =================================== WIRING ==================================== */

function onGlobalTaskClick(e) {
  const actionEl = e.target.closest("[data-action]");
  if (!actionEl) return;
  const wrapper = e.target.closest("[data-task-id]");
  if (!wrapper) return;
  const id = wrapper.dataset.taskId;
  if (actionEl.dataset.action === "toggle") toggleTaskComplete(id);
  else if (actionEl.dataset.action === "edit") openEditor(id);
}

function wireStaticEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  document.getElementById("readinessBadge").addEventListener("click", () => switchView("roadmap"));

  document.body.addEventListener("click", onGlobalTaskClick);

  const grid = document.getElementById("quadrantGrid");
  grid.addEventListener("click", onQuadrantGridClick);
  grid.addEventListener("change", onQuadrantGridChange);
  grid.addEventListener("submit", onQuadrantGridSubmit);

  document.getElementById("listsTermToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    listsTerm = btn.dataset.term;
    renderLists();
  });
  document.getElementById("historyTermToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    historyTerm = btn.dataset.term;
    renderHistory();
  });

  document.getElementById("weightsToggle").addEventListener("click", () => {
    document.getElementById("weightsPanel").classList.toggle("hidden");
  });
  document.getElementById("weightsPanel").addEventListener("input", onWeightsPanelInput);
  document.getElementById("roadmapSvgWrap").addEventListener("click", onRoadmapSvgClick);
  document.getElementById("pillarCards").addEventListener("submit", onPillarCardsSubmit);

  fieldQuadrant.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill-option");
    if (!btn) return;
    fieldQuadrant.querySelectorAll(".pill-option").forEach((b) => b.classList.toggle("active", b === btn));
  });
  fieldTermWrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    fieldTermWrap.querySelectorAll(".segmented-btn").forEach((b) => b.classList.toggle("active", b === btn));
    toggleLongFields(btn.dataset.term === "long");
  });
  fieldPillar.addEventListener("change", () => {
    fieldFocus.innerHTML = focusOptionsHtml(fieldPillar.value);
  });
  taskDeleteBtn.addEventListener("click", () => editingId && deleteTask(editingId));
  taskForm.addEventListener("submit", onTaskFormSubmit);
  document.getElementById("taskModalClose").addEventListener("click", closeModal);
  document.getElementById("taskCancelBtn").addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalOverlay.classList.contains("hidden")) closeModal();
  });
}

function init() {
  wireStaticEvents();
  renderReadiness();
  renderToday();
}

document.addEventListener("DOMContentLoaded", init);
