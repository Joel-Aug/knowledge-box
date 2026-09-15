// Variables used by Scriptable.
// icon-color: yellow; icon-glyph: road;
/* ==========================================================================
   COURSE TO COO — iPhone home screen widget (Scriptable app)

   Setup:
   1. Install the free "Scriptable" app from the App Store.
   2. Open it, tap +, paste this whole file in, name it "Course to COO".
      (If you copied this from the app's Cloud Sync panel, the three
      constants below are already filled in with your details — skip to
      step 3.)
   3. Fill in the three constants below if they still say PASTE_...
   4. Long-press your Home Screen -> + -> Scriptable -> add a Small or
      Medium widget -> tap it -> choose the "Course to COO" script.
   ========================================================================== */

const WORKER_URL = "PASTE_YOUR_WORKER_URL_HERE";
const SYNC_KEY = "PASTE_YOUR_SYNC_KEY_HERE";
const APP_URL = "PASTE_YOUR_APP_URL_HERE"; // e.g. https://you.github.io/knowledge-box/task-planner/

function themedColor(lightHex, darkHex) {
  return Color.dynamic(new Color(lightHex), new Color(darkHex));
}

const COLOR_BG = themedColor("#f6f1e4", "#14161b");
const COLOR_TEXT = themedColor("#241f16", "#efe7d8");
const COLOR_TEXT_DIM = themedColor("#8a8069", "#8b8171");
const COLOR_BRASS = themedColor("#96731a", "#c9a227");
const QUADRANT_COLORS = {
  ui: themedColor("#9c3540", "#b3454f"),
  inu: themedColor("#96731a", "#c9a227"),
  uni: themedColor("#2b7773", "#3c8f8a"),
  neither: themedColor("#6b6151", "#7d7466"),
};

function to12h(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")}${period}`;
}

async function fetchToday() {
  const base = WORKER_URL.replace(/\/$/, "");
  const req = new Request(`${base}/today?key=${encodeURIComponent(SYNC_KEY)}`);
  req.timeoutInterval = 10;
  return await req.loadJSON();
}

async function run() {
  const widget = new ListWidget();
  widget.backgroundColor = COLOR_BG;
  if (APP_URL && !APP_URL.startsWith("PASTE_")) widget.url = APP_URL;
  widget.setPadding(14, 14, 12, 14);

  let data = null;
  let errorMessage = null;
  if (WORKER_URL.startsWith("PASTE_") || SYNC_KEY.startsWith("PASTE_")) {
    errorMessage = "Set WORKER_URL and SYNC_KEY at the top of this script.";
  } else {
    try {
      data = await fetchToday();
    } catch (e) {
      errorMessage = "Couldn't reach the Worker — check the URL and key.";
    }
  }

  const header = widget.addStack();
  header.centerAlignContent();
  const title = header.addText("COURSE TO COO");
  title.font = Font.boldSystemFont(11);
  title.textColor = COLOR_BRASS;
  header.addSpacer();
  const pctText = header.addText(data ? `${data.readiness}%` : "—");
  pctText.font = Font.boldSystemFont(11);
  pctText.textColor = COLOR_BRASS;

  widget.addSpacer(8);

  if (errorMessage) {
    const err = widget.addText(errorMessage);
    err.font = Font.systemFont(12);
    err.textColor = COLOR_TEXT_DIM;
  } else if (!data.tasks.length) {
    const empty = widget.addText("Nothing scheduled today.");
    empty.font = Font.italicSystemFont(12);
    empty.textColor = COLOR_TEXT_DIM;
  } else {
    const family = config.widgetFamily || "medium";
    const maxRows = family === "small" ? 3 : family === "large" ? 8 : 5;
    const shown = data.tasks.slice(0, maxRows);

    for (const t of shown) {
      const row = widget.addStack();
      row.centerAlignContent();
      row.spacing = 6;

      const dot = row.addText("●");
      dot.font = Font.systemFont(10);
      dot.textColor = QUADRANT_COLORS[t.quadrant] || COLOR_TEXT_DIM;

      const time = row.addText(t.startTime ? to12h(t.startTime) : "Any");
      time.font = Font.systemFont(10);
      time.textColor = COLOR_TEXT_DIM;

      const titleText = row.addText(t.title);
      titleText.font = Font.systemFont(12);
      titleText.textColor = t.status === "completed" ? COLOR_TEXT_DIM : COLOR_TEXT;
      titleText.lineLimit = 1;

      widget.addSpacer(4);
    }

    if (data.tasks.length > maxRows) {
      const more = widget.addText(`+${data.tasks.length - maxRows} more`);
      more.font = Font.systemFont(10);
      more.textColor = COLOR_TEXT_DIM;
    }
  }

  widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentMedium();
  }
  Script.complete();
}

await run();
