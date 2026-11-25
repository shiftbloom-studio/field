// Account watchers: things Cloudflare has no native notification for.
//  1. Workers AI usage: once an hour, sum the neurons of the last hour and of the day so far.
//  2. Access changes: every run, read the account audit log for non-read actions on Access.
// Both need CF_API_TOKEN (secret) and CF_ACCOUNT_ID. Without them nothing runs.

import { alert } from "./health.js";

const API = "https://api.cloudflare.com/client/v4";
// Workers AI list price per 1,000 neurons, in USD.
const USD_PER_1K_NEURONS = 0.011;

export const WATCHERS = {
  "ai-usage": "Workers AI usage",
  "access-changes": "Access changes",
};

export const watchEnabled = (env) => !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID);

async function cf(env, path, init = {}) {
  const r = await fetch(API + path, {
    ...init,
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json", ...init.headers },
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.success === false || j?.errors?.length) {
    const why = (j?.errors || []).map((e) => e.message).join("; ") || "no details";
    throw new Error(`Cloudflare API answered ${r.status}: ${why}`);
  }
  return j;
}

async function getKey(env, key) {
  return (await env.DB.prepare("SELECT value FROM watch WHERE key = ?").bind(key).first())?.value ?? null;
}

async function setKey(env, key, value) {
  await env.DB.prepare("INSERT INTO watch (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);

/** Sum of Workers AI neurons since `from`. */
async function neuronsSince(env, from) {
  const query = `query($a: String!, $from: Time!) { viewer { accounts(filter: { accountTag: $a }) {
    ai: aiInferenceAdaptiveGroups(limit: 1, filter: { datetime_geq: $from }) { sum { totalNeurons } } } } }`;
  const j = await cf(env, "/graphql", { method: "POST", body: JSON.stringify({ query, variables: { a: env.CF_ACCOUNT_ID, from: from.toISOString() } }) });
  return j?.data?.viewer?.accounts?.[0]?.ai?.[0]?.sum?.totalNeurons || 0;
}

export async function checkAiUsage(env, at = new Date()) {
  const hourly = num(env.AI_HOURLY_NEURONS, 2_000_000);
  const dailyUsd = num(env.AI_DAILY_USD, 7);
  const midnight = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const [hour, day] = await Promise.all([neuronsSince(env, new Date(at - 3600e3)), neuronsSince(env, midnight)]);

  // Project today's spend from the rate so far; the first hour counts as a full hour to avoid wild guesses.
  const hoursSoFar = Math.max(1, (at - midnight) / 3600e3);
  const projected = (day / hoursSoFar) * 24 * (USD_PER_1K_NEURONS / 1000);
  const reasons = [];
  if (hour > hourly) reasons.push(`${Math.round(hour).toLocaleString("en-GB")} neurons in the last hour (limit ${hourly.toLocaleString("en-GB")})`);
  if (projected > dailyUsd) reasons.push(`on track for ${projected.toFixed(2)} USD today (limit ${dailyUsd} USD)`);

  const ts = Math.floor(at / 1000);
  const open = await env.DB.prepare("SELECT id, started_at FROM incidents WHERE app = 'ai-usage' AND resolved_at IS NULL ORDER BY id DESC LIMIT 1").first();
  if (reasons.length && !open) {
    const error = reasons.join("; ");
    await env.DB.prepare("INSERT INTO incidents (app, started_at, error) VALUES ('ai-usage', ?, ?)").bind(ts, error).run();
    await alert(env, `🔴 Workers AI usage is high: ${error}`);
  } else if (!reasons.length && open) {
    await env.DB.prepare("UPDATE incidents SET resolved_at = ? WHERE id = ?").bind(ts, open.id).run();
    await alert(env, "🟢 Workers AI usage is back to normal");
  }
  return { hour, day, projected, alerting: reasons.length > 0 };
}

const actorOf = (e) => e.actor?.email || e.actor?.token_name || e.actor?.type || "someone";

export async function checkAccessChanges(env, at = new Date()) {
  // Audit entries can show up a little late, so read up to two minutes ago and continue from there next time.
  const before = new Date(at - 120e3).toISOString();
  const since = await getKey(env, "audit_since");
  if (!since) {
    await setKey(env, "audit_since", before); // first run: start from now, don't replay history
    return { changes: 0 };
  }
  const products = String(env.ACCESS_WATCH_PRODUCTS || "access").split(",").map((s) => s.trim()).filter(Boolean);
  const events = [];
  for (const product of products) {
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({ since, before, resource_product: product, "action_type.not": "view", limit: "100", direction: "asc" });
      if (cursor) q.set("cursor", cursor);
      const j = await cf(env, `/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/logs/audit?${q}`);
      events.push(...(j.result || []));
      cursor = j.result_info?.cursor;
      if (!cursor || !(j.result || []).length) break;
    }
  }
  if (events.length) {
    const lines = events.slice(0, 8).map((e) => `${e.action?.description || `${e.action?.type} ${e.resource?.type}`} by ${actorOf(e)}`);
    const more = events.length > lines.length ? ` and ${events.length - lines.length} more` : "";
    const summary = lines.join("; ") + more;
    const ts = Math.floor(at / 1000);
    await env.DB.prepare("INSERT INTO incidents (app, started_at, resolved_at, error) VALUES ('access-changes', ?, ?, ?)").bind(ts, ts, summary.slice(0, 900)).run();
    await alert(env, `🔐 ${events.length} Access change${events.length === 1 ? "" : "s"}: ${summary}`);
  }
  await setKey(env, "audit_since", before);
  return { changes: events.length };
}

/** Called from the cron. Errors are logged, never thrown, so health checks keep running. */
export async function runWatchers(env, at = new Date()) {
  if (!watchEnabled(env)) return;
  const jobs = [checkAccessChanges(env, at)];
  if (at.getUTCMinutes() < 5) jobs.push(checkAiUsage(env, at));
  for (const r of await Promise.allSettled(jobs)) if (r.status === "rejected") console.error("watcher failed", r.reason);
}
