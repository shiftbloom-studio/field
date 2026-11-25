import { apps } from "./config.ts";
import type { App, Bucket, Env, ProbeResult, StateRow } from "./types.ts";

const now = () => Math.floor(Date.now() / 1000);
const TIMEOUT_MS = 10_000;

/** Probe one app: HTTP (service binding first, public URL second) plus an optional D1 ping. */
export async function probe(env: Env, app: App): Promise<ProbeResult> {
  const started = Date.now();
  const base = app.url || `https://${app.id}.invalid`;
  const target = new URL(app.health || "/", base);
  const req = new Request(target, { headers: { "user-agent": "field-health/1", accept: "application/json, text/plain" }, redirect: "manual" });
  const binding = (app.service && env[app.service]) as Fetcher | undefined | "";
  let status: number | null = null, error: string | null = null, detail: string | null = null;

  try {
    let res: Response;
    if (binding && typeof binding.fetch === "function") res = await binding.fetch(req, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    else if (app.url) res = await fetch(req, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    else throw new Error("neither a service binding nor a url is configured");
    status = res.status;
    const type = res.headers.get("content-type") || "";
    if (type.includes("json")) {
      const text = (await res.text()).slice(0, 600);
      detail = text;
    } else {
      await res.body?.cancel();
    }
    const expected = Array.isArray(app.expect) ? app.expect.includes(status) : status >= 200 && status < 400;
    if (!expected) error = `HTTP ${status}`;
  } catch (e) {
    error = (e as Error)?.name === "TimeoutError" ? `no answer after ${TIMEOUT_MS / 1000}s` : String((e as Error)?.message || e);
  }

  if (!error && app.db && env[app.db]) {
    try {
      await (env[app.db] as D1Database).prepare("SELECT 1").first();
    } catch (e) {
      error = `D1: ${(e as Error)?.message || e}`;
    }
  }
  return { ok: !error, status, ms: Date.now() - started, error, detail };
}

/**
 * Send an alert to every configured channel: email (send_email binding ALERT_MAIL plus
 * ALERT_EMAIL_FROM / ALERT_EMAIL_TO) and/or a Discord or Slack webhook (ALERT_WEBHOOK).
 * Callers only alert on state changes, so nothing repeats every five minutes.
 */
export async function alert(env: Env, text: string): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  if (env.ALERT_MAIL && env.ALERT_EMAIL_TO && env.ALERT_EMAIL_FROM) {
    const subject = `[field] ${text.replace(/\s+/g, " ").slice(0, 120)}`;
    jobs.push(
      env.ALERT_MAIL.send({ from: parseFrom(env.ALERT_EMAIL_FROM), to: env.ALERT_EMAIL_TO, subject, text: `${text}\n` })
        .catch((e) => console.error("alert mail failed", e)),
    );
  }
  if (env.ALERT_WEBHOOK) {
    // Works with Discord ("content") and Slack-compatible ("text") incoming webhooks.
    jobs.push(
      fetch(env.ALERT_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text, text }),
      }).catch((e) => console.error("alert webhook failed", e)),
    );
  }
  if (!jobs.length) console.warn("alert (no channel configured):", text);
  await Promise.all(jobs);
}

/** "Name <a@b>" → { name, email }; a bare address stays a string. */
export function parseFrom(v: unknown): string | { name: string; email: string } {
  const t = String(v).trim();
  const open = t.lastIndexOf("<");
  if (open < 0 || !t.endsWith(">")) return t;
  const email = t.slice(open + 1, -1).trim();
  if (!email.includes("@") || /[\s<>]/.test(email)) return t;
  return { name: t.slice(0, open).trim().replace(/^"|"$/g, ""), email };
}

/** Store a probe result, keep `state` current and open/close incidents. */
export async function record(env: Env, app: App, r: ProbeResult, ts = now()): Promise<ProbeResult & { fails: number }> {
  const prev = await env.DB.prepare("SELECT * FROM state WHERE app = ?").bind(app.id).first<StateRow>();
  const fails = r.ok ? 0 : (prev?.fails || 0) + 1;
  const since = prev && !!prev.ok === r.ok ? prev.since : ts;

  const stmts = [
    env.DB.prepare("INSERT OR REPLACE INTO checks (app, ts, ok, status, ms, error) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(app.id, ts, r.ok ? 1 : 0, r.status, r.ms, r.error),
    env.DB.prepare(
      `INSERT INTO state (app, ok, since, last_ts, status, ms, error, fails, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(app) DO UPDATE SET ok = excluded.ok, since = excluded.since, last_ts = excluded.last_ts, status = excluded.status,
         ms = excluded.ms, error = excluded.error, fails = excluded.fails, detail = excluded.detail`,
    ).bind(app.id, r.ok ? 1 : 0, since, ts, r.status, r.ms, r.error, fails, r.detail),
  ];

  const open = await env.DB.prepare("SELECT id, started_at FROM incidents WHERE app = ? AND resolved_at IS NULL ORDER BY id DESC LIMIT 1").bind(app.id).first<{ id: number; started_at: number }>();
  let message: string | null = null;
  if (!r.ok && fails === 2 && !open) {
    stmts.push(env.DB.prepare("INSERT INTO incidents (app, started_at, error) VALUES (?, ?, ?)").bind(app.id, prev?.since && !prev.ok ? prev.since : ts, r.error));
    message = `🔴 ${app.name} is down: ${r.error}`;
  } else if (r.ok && open) {
    stmts.push(env.DB.prepare("UPDATE incidents SET resolved_at = ? WHERE id = ?").bind(ts, open.id));
    const mins = Math.max(1, Math.round((ts - open.started_at) / 60));
    message = `🟢 ${app.name} is back up after ${mins} min`;
  }
  await env.DB.batch(stmts);
  if (message) await alert(env, message);
  return { ...r, fails };
}

/** Cron entry point: probe every active app in parallel. */
export async function runAll(env: Env): Promise<Record<string, Partial<ProbeResult>>> {
  const ts = now();
  const list = apps(env).filter((a) => a.status !== "planned");
  const results = await Promise.all(
    list.map(async (a) => {
      try {
        return [a.id, await record(env, a, await probe(env, a), ts)] as const;
      } catch (e) {
        console.error("check failed", a.id, e);
        return [a.id, { ok: false, error: String((e as Error)?.message || e) }] as const;
      }
    }),
  );
  return Object.fromEntries(results);
}

/** Drop check history older than RETENTION_DAYS (default 30). */
export async function prune(env: Env): Promise<void> {
  const days = Number(env.RETENTION_DAYS) || 30;
  const cut = now() - days * 86400;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM checks WHERE ts < ?").bind(cut),
    env.DB.prepare("DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?").bind(cut),
    env.DB.prepare("DELETE FROM audit WHERE ts < ?").bind(now() - 365 * 86400),
  ]);
}

/** Uptime per app over a window, as a ratio 0..1 (null when there is no data). */
export async function uptime(env: Env, seconds: number): Promise<Record<string, number | null>> {
  const { results } = await env.DB.prepare("SELECT app, AVG(ok) AS up, COUNT(*) AS n FROM checks WHERE ts >= ? GROUP BY app")
    .bind(now() - seconds).all<{ app: string; up: number; n: number }>();
  return Object.fromEntries(results.map((r) => [r.app, r.n ? r.up : null]));
}

/** Bucketed history for the strip charts: `buckets` slots over `seconds`. */
export async function history(env: Env, appId: string, seconds: number, buckets: number): Promise<Bucket[]> {
  const from = now() - seconds;
  const size = Math.ceil(seconds / buckets);
  const { results } = await env.DB.prepare(
    `SELECT CAST((ts - ?) / ? AS INTEGER) AS b, AVG(ok) AS up, COUNT(*) AS n, AVG(ms) AS ms
       FROM checks WHERE app = ? AND ts >= ? GROUP BY b`,
  ).bind(from, size, appId, from).all<{ b: number; up: number; n: number; ms: number }>();
  const out: Bucket[] = Array.from({ length: buckets }, (_, i) => ({ from: from + i * size, up: null, n: 0, ms: null }));
  for (const r of results) if (r.b >= 0 && r.b < buckets) Object.assign(out[r.b], { up: r.up, n: r.n, ms: r.ms });
  return out;
}

/** Same as history() for every app at once (overview page). */
export async function historyAll(env: Env, seconds: number, buckets: number): Promise<Record<string, Bucket[]>> {
  const from = now() - seconds;
  const size = Math.ceil(seconds / buckets);
  const { results } = await env.DB.prepare(
    `SELECT app, CAST((ts - ?) / ? AS INTEGER) AS b, AVG(ok) AS up, COUNT(*) AS n
       FROM checks WHERE ts >= ? GROUP BY app, b`,
  ).bind(from, size, from).all<{ app: string; b: number; up: number; n: number }>();
  const map: Record<string, Bucket[]> = {};
  for (const r of results) {
    const arr = (map[r.app] ||= Array.from({ length: buckets }, (_, i): Bucket => ({ from: from + i * size, up: null, n: 0 })));
    if (r.b >= 0 && r.b < buckets) Object.assign(arr[r.b], { up: r.up, n: r.n });
  }
  return map;
}
