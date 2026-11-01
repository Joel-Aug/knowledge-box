/* FLUX.2 Studio relay: a tiny Cloudflare Worker (free plan).
 *
 * Only needed if your phone's browser isn't allowed to call the Black Forest
 * Labs API directly. It passes requests through to BFL unchanged and adds the
 * permission headers (CORS) the browser needs.
 *
 * It never stores anything and has no API key of its own: your phone sends
 * your key with each request. It only forwards to Black Forest Labs
 * addresses, so it can't be used as a general-purpose proxy.
 *
 * Setup from your phone: see flux2-mobile/README.md, step 4.
 * Usage: https://<your-worker>.workers.dev/?url=<BFL url>
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "x-key, content-type, accept",
  "Access-Control-Max-Age": "86400",
};

function allowed(target) {
  if (target.protocol !== "https:") return false;
  const h = target.hostname;
  return (
    h === "bfl.ai" || h.endsWith(".bfl.ai") ||
    // BFL has delivered result images from Azure blob storage under "bfl…" accounts
    (h.startsWith("bfl") && h.endsWith(".blob.core.windows.net"))
  );
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const raw = new URL(request.url).searchParams.get("url");
    if (!raw) return new Response("FLUX.2 Studio relay is running.", { headers: CORS });

    let target;
    try { target = new URL(raw); } catch { return new Response("Bad url", { status: 400, headers: CORS }); }
    if (!allowed(target)) return new Response("Only Black Forest Labs addresses are allowed.", { status: 403, headers: CORS });

    const headers = new Headers();
    for (const h of ["x-key", "content-type", "accept"]) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
    });

    const out = new Headers(CORS);
    const ct = upstream.headers.get("content-type");
    if (ct) out.set("content-type", ct);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
