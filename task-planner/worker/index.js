/* ==========================================================================
   COURSE TO COO — sync worker
   A tiny Cloudflare Worker that stores one JSON blob (the app's state) in
   KV, and derives two read-only views from it: a live .ics calendar feed
   and a compact JSON summary for the iPhone widget. Single user, so "auth"
   is one shared secret (env.SYNC_KEY) rather than real accounts — enough
   for a personal task list, not for anything sensitive.

   Routes:
     GET  /state           -> the stored app state (X-Sync-Key header)
     PUT  /state            -> replace the stored app state (X-Sync-Key header)
     GET  /calendar.ics?key=... -> subscribable calendar feed of open,
                                   scheduled tasks (webcal)
     GET  /today?key=...    -> today's scheduled tasks + readiness, for the
                                   Scriptable widget
   ========================================================================== */

const KV_KEY = "state";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sync-Key",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function text(body, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(body, { status, headers: { "Content-Type": contentType, ...CORS_HEADERS } });
}

function isAuthorized(request, url, env) {
  if (!env.SYNC_KEY) return false;
  const provided = request.headers.get("X-Sync-Key") || url.searchParams.get("key");
  return !!provided && provided === env.SYNC_KEY;
}

function defaultState() {
  return { version: 1, tasks: [], settings: { pillarWeights: {}, theme: "auto" }, updatedAt: null };
}

async function readState(env) {
  const raw = await env.STATE_KV.get(KV_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

/* ================================= ICS FEED ================================== */

function icsEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function addDaysToISODate(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

function addMinutesToTime(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

function buildICS(state, { origin }) {
  const now = new Date();
  const dtstamp =
    `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}` +
    `T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;

  const QUADRANT_LABEL = { ui: "Important & Urgent", inu: "Important & Not Urgent", uni: "Urgent & Not Important", neither: "Neither" };

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Course to COO//Task Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Course to COO",
    "X-WR-TIMEZONE:UTC",
  ];

  const scheduled = (state.tasks || []).filter((t) => t.dueDate && t.status === "open");

  for (const t of scheduled) {
    const datePart = t.dueDate.replace(/-/g, "");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${t.id}@course-to-coo`);
    lines.push(`DTSTAMP:${dtstamp}`);

    if (t.startTime) {
      const start = t.startTime.replace(":", "");
      const end = (t.endTime || addMinutesToTime(t.startTime, 30)).replace(":", "");
      lines.push(`DTSTART:${datePart}T${start}00`);
      lines.push(`DTEND:${datePart}T${end}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${datePart}`);
      lines.push(`DTEND;VALUE=DATE:${addDaysToISODate(t.dueDate, 1)}`);
    }

    lines.push(`SUMMARY:${icsEscape(t.title)}`);
    const descParts = [];
    if (t.notes) descParts.push(t.notes);
    descParts.push(`${t.term === "long" ? "Long-run" : "Short-run"} · ${QUADRANT_LABEL[t.quadrant] || t.quadrant}`);
    lines.push(`DESCRIPTION:${icsEscape(descParts.join("\n"))}`);
    lines.push(`CATEGORIES:${icsEscape(t.term === "long" ? "Long-run" : "Short-run")}`);
    if (origin) lines.push(`URL:${origin}/index.html`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n");
}

// RFC 5545 line folding: no line may exceed 75 octets (excluding the CRLF);
// continuation lines start with a single space. Approximated per-character
// rather than per-UTF-8-octet, which is fine for the ASCII-heavy content
// this feed produces and safe even when it isn't (just folds a little early).
function foldLine(line) {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    chunks.push(rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) chunks.push(rest);
  return chunks.join("\r\n ");
}

/* ================================ TODAY JSON ================================= */

function todayISODateUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function readiness(state) {
  const tasks = state.tasks || [];
  const byPillar = {};
  for (const t of tasks) {
    if (t.term !== "long" || !t.pillarId) continue;
    byPillar[t.pillarId] ??= { total: 0, done: 0 };
    byPillar[t.pillarId].total += 1;
    if (t.status === "completed") byPillar[t.pillarId].done += 1;
  }
  const weights = state.settings?.pillarWeights || {};
  const pillarIds = Object.keys({ ...byPillar, ...weights });
  if (!pillarIds.length) return 0;
  let sumW = 0, sumWP = 0;
  for (const id of pillarIds) {
    const w = weights[id] ?? 1;
    const stat = byPillar[id];
    const pct = stat && stat.total ? (stat.done / stat.total) * 100 : 0;
    sumW += w;
    sumWP += w * pct;
  }
  return sumW ? Math.round(sumWP / sumW) : 0;
}

function buildToday(state) {
  const date = todayISODateUTC();
  const tasks = (state.tasks || [])
    .filter((t) => t.dueDate === date)
    .sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99"))
    .map((t) => ({
      title: t.title,
      quadrant: t.quadrant,
      term: t.term,
      startTime: t.startTime || null,
      endTime: t.endTime || null,
      status: t.status,
    }));
  return { date, readiness: readiness(state), tasks };
}

/* =================================== ROUTES =================================== */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/state" && request.method === "GET") {
      if (!isAuthorized(request, url, env)) return json({ error: "unauthorized" }, 401);
      return json(await readState(env));
    }

    if (url.pathname === "/state" && request.method === "PUT") {
      if (!isAuthorized(request, url, env)) return json({ error: "unauthorized" }, 401);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      if (!body || !Array.isArray(body.tasks)) return json({ error: "body must include a tasks array" }, 400);
      body.updatedAt = new Date().toISOString();
      await env.STATE_KV.put(KV_KEY, JSON.stringify(body));
      return json({ ok: true, updatedAt: body.updatedAt });
    }

    if (url.pathname === "/calendar.ics" && request.method === "GET") {
      if (!isAuthorized(request, url, env)) return text("Unauthorized", 401);
      const state = await readState(env);
      return text(buildICS(state, { origin: env.APP_ORIGIN || "" }), 200, "text/calendar; charset=utf-8");
    }

    if (url.pathname === "/today" && request.method === "GET") {
      if (!isAuthorized(request, url, env)) return json({ error: "unauthorized" }, 401);
      const state = await readState(env);
      return json(buildToday(state));
    }

    return json({ error: "not found" }, 404);
  },
};
