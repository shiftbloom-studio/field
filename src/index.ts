// field: the shiftbloom studio intranet hub.
// One place for every service: health checks on a cron, uptime history in D1,
// and admin screens that talk to each app through bindings.
import { verifyAccess } from "./auth.ts";
import { apps, app as findApp, links, tz } from "./config.ts";
import { runAll, prune, probe, record, uptime, uptimeProps, history, historyAll } from "./health.ts";
import { adapterFor, tokensFor } from "./adapters/index.ts";
import { readTokenForm } from "./tokens.ts";
import { runWatchers, WATCHERS } from "./watch.ts";
import { handleAsset } from "./assets.ts";
import { imprint, privacy } from "./legal.ts";
import { faviconSvg } from "./brand.ts";
import { phCapture, phException } from "./posthog.ts";
import { overviewPage, appPage, auditPage, errorPage, health, tokenCreatedPage } from "./ui.ts";
import type { App, AuditRow, CheckRow, Env, IncidentRow, Panel, StateRow, Tile, TokensView, User } from "./types.ts";

// Scripts run only from field itself ('self', which also covers Cloudflare's /cdn-cgi/challenge-platform)
// or inline with this response's nonce. Cloudflare reads the nonce from this header and puts it on the
// scripts it injects (JavaScript detections), so no 'unsafe-inline' is needed.
const csp = (nonce: string) =>
  `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`;
const SECURITY = {
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
const newNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
// Every <script> field renders is its own markup (all dynamic text goes through esc(), so "<script" never
// comes from data); each one gets the nonce here instead of threading it through every page builder.
const html = (body: string, status = 200) => {
  const nonce = newNonce();
  return new Response(body.replaceAll("<script", `<script nonce="${nonce}"`), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": csp(nonce), ...SECURITY },
  });
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const back = (url: string, key: string, msg: string) => {
  const u = new URL(url);
  u.search = "";
  u.searchParams.set(key, msg);
  return Response.redirect(u.toString(), 303);
};

// Forms post back to field itself. Anything else is refused (CSRF guard on top of Access).
function sameOrigin(req: Request): boolean {
  const host = new URL(req.url).host;
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  // Browsers send "Origin: null" for form posts from a page with Referrer-Policy: no-referrer,
  // which field sets. Then (and for anything unparsable) the fetch metadata header decides.
  if (origin && origin !== "null") {
    try { return new URL(origin).host === host; } catch { return false; }
  }
  return site === "same-origin";
}

// The row is written before the action runs, so an action never happens without a trace.
// If the action finishes, the row gets its result; if the Worker dies halfway, "pending" stays.
async function auditStart(env: Env, user: User, appId: string, action: string, target: string | null | undefined): Promise<number> {
  const row = await env.DB.prepare("INSERT INTO audit (ts, actor, app, action, target, detail) VALUES (?, ?, ?, ?, ?, 'pending') RETURNING id")
    .bind(Math.floor(Date.now() / 1000), user.email, appId, action, target || null)
    .first<{ id: number }>();
  return row!.id;
}

async function auditFinish(env: Env, id: number, target: string | null | undefined, detail: string | null | undefined): Promise<void> {
  await env.DB.prepare("UPDATE audit SET target = COALESCE(?, target), detail = ? WHERE id = ?")
    .bind(target ?? null, detail ?? null, id)
    .run();
}

async function states(env: Env): Promise<Record<string, StateRow>> {
  const { results } = await env.DB.prepare("SELECT * FROM state").all<StateRow>();
  return Object.fromEntries(results.map((s) => [s.app, s]));
}

async function overview(req: Request, env: Env, user: User): Promise<Response> {
  const list = apps(env);
  const [st, up24, strips, incidents] = await Promise.all([
    states(env),
    uptime(env, 86400),
    historyAll(env, 86400, 48),
    env.DB.prepare("SELECT * FROM incidents WHERE resolved_at IS NULL OR started_at >= ? ORDER BY resolved_at IS NOT NULL, started_at DESC LIMIT 12")
      .bind(Math.floor(Date.now() / 1000) - 7 * 86400).all<IncidentRow>().then((r) => r.results),
  ]);
  const stats = Object.fromEntries(
    await Promise.all(
      list.map(async (a): Promise<[string, Tile[]]> => {
        const ad = adapterFor(env, a);
        if (!ad) return [a.id, []];
        try { return [a.id, await ad.stats(env, a)]; } catch (e) { console.error("stats", a.id, e); return [a.id, []]; }
      }),
    ),
  );
  const tokenApps = new Set(list.filter((a) => tokensFor(env, a)).map((a) => a.id));
  return html(overviewPage(env, {
    user, list, states: st, up24, strips, stats, incidents, tokenApps,
    open: incidents.filter((i) => !i.resolved_at).length,
    links: links(env), params: new URL(req.url).searchParams, tz: tz(env),
  }));
}

/** Removes owner-only actions from a panel shown to a member. */
function hideOwnerActions(p: Panel, ownerOnly: string[] | undefined): Panel {
  if (!ownerOnly?.length) return p;
  const keep = (a: { action: string }) => !ownerOnly.includes(a.action);
  return { ...p, actions: p.actions?.filter(keep), tables: p.tables.map((t) => ({ ...t, rowActions: t.rowActions?.filter(keep) })) };
}

async function detail(req: Request, env: Env, user: User, app: App): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const ad = adapterFor(env, app);
  const [state, d1, d7, d30, strip7d, checks, incidents] = await Promise.all([
    env.DB.prepare("SELECT * FROM state WHERE app = ?").bind(app.id).first<StateRow>(),
    uptime(env, 86400), uptime(env, 7 * 86400), uptime(env, 30 * 86400),
    history(env, app.id, 7 * 86400, 84),
    env.DB.prepare("SELECT * FROM checks WHERE app = ? ORDER BY ts DESC LIMIT 12").bind(app.id).all<CheckRow>().then((r) => r.results),
    env.DB.prepare("SELECT * FROM incidents WHERE app = ? ORDER BY started_at DESC LIMIT 20").bind(app.id).all<IncidentRow>().then((r) => r.results),
  ]);
  let tiles: Tile[] | null = null, panel: Panel | null = null, panelError: string | null = null, tokens: TokensView | null | undefined = null;
  const tp = tokensFor(env, app);
  if (ad) {
    try {
      [tiles, panel, tokens] = await Promise.all([
        ad.stats(env, app),
        ad.panel(env, app, params, user).then((p) => (user.owner ? p : hideOwnerActions(p, ad.ownerOnly))),
        tp && Promise.all([tp.list(env, app, user), tp.fields ? tp.fields(env, app, user) : []])
          .then(([rows, fields]): TokensView => ({ rows, fields, about: tp.about, ownerLabel: tp.ownerLabel, hasOwner: rows.some((r) => r.owner) }))
          // e.g. the app's token migration isn't applied yet: show that, keep the rest of the page
          .catch((e): TokensView => (console.error("tokens", app.id, e), { rows: [], fields: [], about: tp.about, error: String(e?.message || e) })),
      ]);
    } catch (e) {
      console.error("panel", app.id, e);
      panelError = String((e as Error)?.message || e);
    }
  }
  return html(appPage(env, { user, app, state, up: { d1, d7, d30 }, strip7d, checks, incidents, tiles, panel, panelError, tokens, params, tz: tz(env) }));
}

async function statusJson(env: Env): Promise<Response> {
  const list = apps(env);
  const [st, up24] = await Promise.all([states(env), uptime(env, 86400)]);
  return json({
    generated: new Date().toISOString(),
    apps: list.map((a) => {
      const s = st[a.id];
      return { id: a.id, name: a.name, url: a.url || null, status: health(s, a).cls, last_check: s ? new Date(s.last_ts * 1000).toISOString() : null, ms: s?.ms ?? null, error: s?.error ?? null, uptime_24h: up24[a.id] ?? null };
    }),
  });
}

/** Same as pathname.replace(/\/+$/, ""), without a regex that backtracks on long slash runs. */
function trimTrailingSlashes(p: string): string {
  let end = p.length;
  while (end > 0 && p.charCodeAt(end - 1) === 47) end--;
  return p.slice(0, end);
}

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = trimTrailingSlashes(url.pathname) || "/";
  const m = req.method;

  const asset = m === "GET" && (await handleAsset(req, ctx, faviconSvg()));
  if (asset) return asset;
  if (path === "/health") return json({ ok: true });
  if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n");

  // Legal pages are public: the Access application has a bypass rule for exactly these paths.
  const legal = ({ "/privacy": ["privacy", "en"], "/datenschutz": ["privacy", "de"], "/imprint": ["imprint", "en"], "/impressum": ["imprint", "de"] } as Record<string, [string, string]>)[path];
  if (legal && (m === "GET" || m === "HEAD")) {
    const [kind, lang] = legal;
    return html(kind === "privacy" ? privacy(env, lang, url.host) : imprint(env, lang));
  }

  let user: User | null = await verifyAccess(req, env).catch((e) => (console.error("access", e), null));
  // Local development only: `wrangler dev` with DEV_BYPASS_ACCESS=true in .dev.vars.
  if (!user && env.DEV_BYPASS_ACCESS === "true" && ["localhost", "127.0.0.1"].includes(url.hostname)) user = { email: "dev@localhost", owner: env.DEV_AS_MEMBER !== "true" };
  if (!user) return html(errorPage(env, 401, "Sign in to continue"), 401);

  if (m === "GET" && path === "/") return overview(req, env, user);
  if (m === "GET" && path === "/api/status") return statusJson(env);
  if (m === "GET" && path === "/audit") {
    const { results } = await env.DB.prepare("SELECT * FROM audit ORDER BY ts DESC LIMIT 200").all<AuditRow>();
    return html(auditPage(env, { user, rows: results, list: apps(env), tz: tz(env) }));
  }

  if (m === "POST" && !sameOrigin(req)) return html(errorPage(env, 403, "That request did not come from field"), 403);

  if (m === "POST" && path === "/check") {
    await runAll(env);
    return back(`${url.origin}/`, "ok", "All services were just checked again.");
  }

  const am = /^\/apps\/([a-z0-9-]{1,32})(?:\/(check|tokens|tokens\/revoke|actions\/([a-z0-9-]{1,40})))?$/.exec(path);
  if (am) {
    const app = findApp(env, am[1]);
    if (!app) return html(errorPage(env, 404, "field does not know this service"), 404);
    const here = `${url.origin}/apps/${app.id}`;
    if (m === "GET" && !am[2]) return detail(req, env, user, app);
    if (m === "POST" && am[2] === "check") {
      if (app.status === "planned") return back(here, "err", "Planned services are not checked yet.");
      const r = await record(env, app, await probe(env, app));
      return back(here, r.ok ? "ok" : "err", r.ok ? `${app.name} answered in ${r.ms} ms.` : `${app.name} is not answering: ${r.error}`);
    }
    if (m === "POST" && (am[2] === "tokens" || am[2] === "tokens/revoke")) {
      const tp = tokensFor(env, app);
      if (!tp) return html(errorPage(env, 404, `${app.name} has no API tokens`), 404);
      const form = await req.formData();
      if (am[2] === "tokens/revoke") {
        const id = String(form.get("id") || "");
        const entry = await auditStart(env, user, app.id, "revoke-token", id);
        try {
          const n = await tp.revoke(env, id, user);
          await auditFinish(env, entry, null, n ? "revoked" : "was already revoked");
          return back(here, "ok", n ? "Token revoked. It stops working right away." : "That token was already revoked.");
        } catch (e) {
          await auditFinish(env, entry, null, `error: ${(e as Error)?.message || e}`);
          return back(here, "err", String((e as Error)?.message || e));
        }
      }
      let input: ReturnType<typeof readTokenForm>;
      try { input = readTokenForm(form); } catch (e) { return back(here, "err", (e as Error).message); }
      const entry = await auditStart(env, user, app.id, "create-token", input.label);
      try {
        const created = await tp.create(env, { ...input, form, user });
        // Never log the token itself: label, prefix and expiry are enough to recognise it.
        await auditFinish(env, entry, `${input.label} (${created.prefix}…)`, input.expiresAt ? `expires ${new Date(input.expiresAt * 1000).toISOString().slice(0, 10)}` : "no expiry");
        return html(tokenCreatedPage(env, { user, app, label: input.label, created, expiresAt: input.expiresAt, tz: tz(env) }));
      } catch (e) {
        await auditFinish(env, entry, null, `error: ${(e as Error)?.message || e}`);
        return back(here, "err", String((e as Error)?.message || e));
      }
    }
    if (m === "POST" && am[3]) {
      const ad = adapterFor(env, app);
      const fn = ad?.actions?.[am[3]];
      if (!fn) return html(errorPage(env, 404, "No such action"), 404);
      if (!user.owner && ad?.ownerOnly?.includes(am[3])) return html(errorPage(env, 403, "Only an owner can do that"), 403);
      const form = await req.formData();
      const entry = await auditStart(env, user, app.id, am[3], String(form.get("id") || ""));
      try {
        const r = await fn(env, app, form, ctx);
        await auditFinish(env, entry, r.target, r.message);
        return back(here, "ok", r.message);
      } catch (e) {
        await auditFinish(env, entry, null, `error: ${(e as Error)?.message || e}`);
        return back(here, "err", String((e as Error)?.message || e));
      }
    }
  }
  return html(errorPage(env, 404, "Nothing here"), 404);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      console.error(e);
      // with ctx the event is handed to waitUntil, so the returned promise is already settled
      void phException(env, ctx, e, { route: new URL(req.url).pathname.split("/").slice(0, 2).join("/") || "/" });
      return html(errorPage(env, 500, "Something went wrong"), 500);
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const d = new Date(event.scheduledTime);
        const [results] = await Promise.all([runAll(env), runWatchers(env, d)]);
        await phCapture(env, null, "uptime_checked", uptimeProps(results));
        if (d.getUTCHours() === 3 && d.getUTCMinutes() < 5) await prune(env);
      })().catch((e) => {
        console.error("cron failed", e);
        return phException(env, null, e, { job: "cron" });
      }),
    );
  },
} satisfies ExportedHandler<Env>;
