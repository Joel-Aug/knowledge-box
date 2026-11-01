const $ = (s) => document.querySelector(s);
const state = { config: null, aspect: "1:1", refs: [], gallery: [], current: null };

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

function setStatus(msg, isError = false) {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("error", isError);
}

async function init() {
  const cfg = await (await fetch("/api/config")).json();
  state.config = cfg;

  const badge = $("#mode-badge");
  badge.textContent = cfg.backend;
  badge.classList.add(cfg.mode);
  if (cfg.problem) {
    $("#problem").textContent = cfg.problem;
    $("#problem").classList.remove("hidden");
  }
  $("#max-refs").textContent = cfg.max_references;

  for (const p of cfg.presets) {
    $("#presets").append(el("button", { type: "button", "data-id": p.id, onclick: () => applyPreset(p) }, p.name));
  }
  for (const [name, dims] of Object.entries(cfg.aspect_ratios)) {
    $("#aspects").append(
      el("button", { type: "button", "data-ar": name, title: `${dims.width} × ${dims.height}`, onclick: () => setAspect(name) }, name)
    );
  }
  setAspect("1:1");
  await loadGallery();
}

function setAspect(name) {
  state.aspect = name;
  document.querySelectorAll("#aspects button").forEach((b) => b.classList.toggle("active", b.dataset.ar === name));
}

function applyPreset(p) {
  const box = $("#prompt");
  if (box.value.trim() && !confirm("Replace the current prompt with this template?")) return;
  box.value = p.prompt;
  setAspect(p.aspect);
  document.querySelectorAll("#presets button").forEach((b) => b.classList.toggle("active", b.dataset.id === p.id));
  // Select the first [placeholder] so the user can type over it right away.
  const start = p.prompt.indexOf("[");
  const end = p.prompt.indexOf("]", start);
  box.focus();
  if (start >= 0 && end > start) box.setSelectionRange(start, end + 1);
}

// ---------- Reference images ----------
function addRefs(files) {
  const max = state.config.max_references;
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    if (state.refs.length >= max) {
      setStatus(`Only ${max} reference images are allowed.`, true);
      break;
    }
    state.refs.push({ file: f, url: URL.createObjectURL(f) });
  }
  renderRefs();
}

function renderRefs() {
  const list = $("#ref-list");
  list.innerHTML = "";
  state.refs.forEach((r, i) => {
    list.append(
      el("div", { class: "ref-item" },
        el("img", { src: r.url, alt: `Reference ${i + 1}` }),
        el("span", { class: "num" }, `image ${i + 1}`),
        el("button", { class: "rm", type: "button", title: "Remove", onclick: () => {
          URL.revokeObjectURL(r.url);
          state.refs.splice(i, 1);
          renderRefs();
        } }, "×")
      )
    );
  });
}

const dz = $("#dropzone");
const input = $("#ref-input");
dz.addEventListener("click", () => input.click());
dz.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && input.click());
input.addEventListener("change", () => { addRefs(input.files); input.value = ""; });
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); addRefs(e.dataTransfer.files); });
document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addRefs(files);
});

// ---------- Generation ----------
async function generate() {
  const prompt = $("#prompt").value.trim();
  if (!prompt) { setStatus("Please enter a prompt first.", true); return; }

  const btn = $("#generate");
  btn.disabled = true;
  const started = Date.now();
  const tick = setInterval(() => setStatus(`Generating… ${Math.round((Date.now() - started) / 1000)}s`), 500);
  setStatus("Generating…");

  const placeholder = el("div", { class: "card pending" },
    el("div", { class: "ph" }, `Generating ${state.aspect}…`),
    el("div", { class: "cap" }, prompt));
  $("#gallery").prepend(placeholder);
  $("#empty").classList.add("hidden");

  const fd = new FormData();
  fd.append("prompt", prompt);
  fd.append("aspect", state.aspect);
  fd.append("seed", $("#seed").value);
  for (const r of state.refs) fd.append("references", r.file, r.file.name);

  try {
    const res = await fetch("/api/generate", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data.detail;
      throw new Error(typeof d === "string" ? d : d ? "Please check your inputs and try again." : `Server error ${res.status}`);
    }
    state.gallery.unshift(data);
    setStatus(`Done in ${Math.round((Date.now() - started) / 1000)}s · seed ${data.seed}`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    clearInterval(tick);
    placeholder.remove();
    btn.disabled = false;
    renderGallery();
  }
}
$("#generate").addEventListener("click", generate);
$("#prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) generate();
});

// ---------- Gallery ----------
async function loadGallery() {
  state.gallery = await (await fetch("/api/gallery")).json();
  renderGallery();
}

function renderGallery() {
  const g = $("#gallery");
  g.querySelectorAll(".card:not(.pending)").forEach((n) => n.remove());
  for (const item of state.gallery) {
    g.append(
      el("div", { class: "card", onclick: () => openViewer(item), title: item.prompt },
        el("img", { src: `/outputs/${item.file}`, alt: item.prompt, loading: "lazy" }),
        el("div", { class: "cap" }, item.prompt))
    );
  }
  $("#count").textContent = state.gallery.length ? `${state.gallery.length} image${state.gallery.length > 1 ? "s" : ""}` : "";
  $("#empty").classList.toggle("hidden", state.gallery.length > 0 || !!g.querySelector(".pending"));
}

function openViewer(item) {
  state.current = item;
  $("#viewer-img").src = `/outputs/${item.file}`;
  $("#viewer-prompt").textContent = item.prompt;
  $("#viewer-meta").textContent =
    `${item.aspect} · ${item.width}×${item.height} · seed ${item.seed} · ${item.backend} · ${item.created.replace("T", " ")}`;
  const refs = $("#viewer-refs");
  refs.innerHTML = "";
  if (item.references?.length) {
    refs.append(el("span", { class: "muted small", style: "width:100%" }, "References used:"));
    for (const r of item.references) refs.append(el("img", { src: `/outputs/${r}`, alt: "reference" }));
  }
  $("#v-download").href = `/outputs/${item.file}`;
  $("#v-download").download = item.file;
  $("#viewer").showModal();
}

$("#v-close").addEventListener("click", () => $("#viewer").close());
$("#viewer").addEventListener("click", (e) => { if (e.target.id === "viewer") $("#viewer").close(); });
$("#v-reuse").addEventListener("click", () => {
  const it = state.current;
  $("#prompt").value = it.prompt;
  setAspect(it.aspect);
  $("#seed").value = it.seed;
  $("#viewer").close();
  $("#prompt").focus();
});
$("#v-ref").addEventListener("click", async () => {
  const it = state.current;
  const blob = await (await fetch(`/outputs/${it.file}`)).blob();
  addRefs([new File([blob], it.file, { type: blob.type || "image/png" })]);
  $("#viewer").close();
});
$("#v-delete").addEventListener("click", async () => {
  const it = state.current;
  if (!confirm("Delete this image from the gallery? This cannot be undone.")) return;
  const res = await fetch(`/api/gallery/${it.id}`, { method: "DELETE" });
  if (res.ok) {
    state.gallery = state.gallery.filter((x) => x.id !== it.id);
    renderGallery();
    $("#viewer").close();
  }
});

init().catch((e) => setStatus(`Could not reach the app server: ${e.message}`, true));
