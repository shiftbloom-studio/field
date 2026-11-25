// Self-hosted font proxy: browsers only ever talk to field's own origin.
// Fontshare returns one family per CSS request, so each family is fetched on its own.

const FONTSHARE = ["clash-display@500,600", "general-sans@400,500,600"].map((f) => `https://api.fontshare.com/v2/css?f[]=${f}&display=swap`);
const MONO = (w) => `https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5/files/jetbrains-mono-latin-${w}-normal.woff2`;
const ALLOWED = /^https:\/\/(cdn\.fontshare\.com\/wf\/[A-Za-z0-9_\-/]+\.(woff2|woff|ttf)|cdn\.jsdelivr\.net\/npm\/@fontsource\/jetbrains-mono@5\/files\/[a-z0-9-]+\.woff2)$/;
const YEAR = "public, max-age=31536000, immutable";
const proxied = (u) => `/assets/x?u=${encodeURIComponent(u)}`;

async function cached(req, ctx, build) {
  const key = new Request(new URL(req.url).toString(), { method: "GET" });
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const res = await build();
  if (res.ok) ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

export async function handleAsset(req, ctx, favicon) {
  const url = new URL(req.url);
  const p = url.pathname;
  if (p === "/favicon.svg" || p === "/favicon.ico")
    return new Response(favicon, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=604800" } });
  if (p === "/assets/fonts.css")
    return cached(req, ctx, async () => {
      let css = "";
      for (const u of FONTSHARE) {
        try {
          const r = await fetch(u, { cf: { cacheTtl: 86400 } });
          if (r.ok) css += (await r.text()) + "\n";
        } catch {}
      }
      css = css.replace(/url\((['"]?)(?:https?:)?\/\/(cdn\.fontshare\.com\/[^'")]+)\1\)/g, (_m, _q, path) => `url('${proxied("https://" + path)}')`);
      for (const w of [400, 500]) css += `@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:${w};font-display:swap;src:url('${proxied(MONO(w))}') format('woff2')}\n`;
      return new Response(css, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=86400" } });
    });
  if (p === "/assets/x") {
    const u = url.searchParams.get("u") || "";
    if (!ALLOWED.test(u)) return new Response("not allowed", { status: 403 });
    return cached(req, ctx, async () => {
      const r = await fetch(u).catch(() => null);
      if (!r || !r.ok) return new Response("upstream error", { status: 502 });
      const type = u.endsWith(".woff") ? "font/woff" : u.endsWith(".ttf") ? "font/ttf" : "font/woff2";
      return new Response(r.body, { headers: { "content-type": type, "cache-control": YEAR } });
    });
  }
  return null;
}
