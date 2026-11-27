// Account watchers: things Cloudflare has no native notification for.
//  1. Workers AI usage: once an hour, sum the neurons of the last hour and of the day so far.
//  2. Access changes: every run, read the account audit log for non-read actions on Access.
//  3. Workers Builds: every run, look at the latest build of each Worker and alert when a production deploy failed.
// All need CF_API_TOKEN (secret) and CF_ACCOUNT_ID. Without them nothing runs.

import { phException } from "./posthog.ts";
import { alert } from "./health.ts";
import type { Env } from "./types.ts";

interface CfResponse { success?: boolean; errors?: { message: string }[]; [key: string]: any }
interface Build {
  build_uuid?: string;
  status?: string;
  build_outcome?: string | null;
  build_trigger_metadata?: { branch?: string; commit_hash?: string; commit_message?: string };
  trigger?: { trigger_name?: string; branch_includes?: string[] };
}
interface AuditEvent { action?: { description?: string; type?: string }; resource?: { type?: string }; actor?: { email?: string; token_name?: string; type?: string } }

const API = "https://api.cloudflare.com/client/v4";
// Workers AI list price per 1,000 neurons, in USD.
const USD_PER_1K_NEURONS = 0.011;

export const WATCHERS: Record<string, string> = {
  "ai-usage": "Workers AI usage",
  "access-changes": "Access changes",
  builds: "Workers Builds",
};

export const watchEnabled = (env: Env): boolean => !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID);

async function cf(env: Env, path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<CfResponse> {
  const r = await fetch(API + path, {
    ...init,
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json", ...init.headers },
  });
  const j = await r.json<CfResponse>().catch(() => null);
  if (!r.ok || j?.success === false || j?.errors?.length) {
    const why = (j?.errors || []).map((e) => e.message).join("; ") || "no details";
    throw new Error(`Cloudflare API answered ${r.status}: ${why}`);
  }
  return j!;
}

async function getKey(env: Env, key: string): Promise<string | null> {
  return (await env.DB.prepare("SELECT value FROM watch WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;
}

async function setKey(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO watch (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

const num = (v: unknown, d: number): number => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);

/** Sum of Workers AI neurons since `from`. */
async function neuronsSince(env: Env, from: Date): Promise<number> {
  const query = `query($a: String!, $from: Time!) { viewer { accounts(filter: { accountTag: $a }) {
    ai: aiInferenceAdaptiveGroups(limit: 1, filter: { datetime_geq: $from }) { sum { totalNeurons } } } } }`;
  const j = await cf(env, "/graphql", { method: "POST", body: JSON.stringify({ query, variables: { a: env.CF_ACCOUNT_ID, from: from.toISOString() } }) });
  return j?.data?.viewer?.accounts?.[0]?.ai?.[0]?.sum?.totalNeurons || 0;
}

/**
 * The limits in force at `at`. Until AI_CREDIT_UNTIL (a date, exclusive) the AI_CREDIT_* limits apply, so a
 * period covered by credits can allow more spend without noise and the normal limits switch on by themselves.
 */
export function aiLimits(env: Env, at: Date): { hourly: number; dailyUsd: number; credit: boolean } {
  const until = env.AI_CREDIT_UNTIL ? Date.parse(String(env.AI_CREDIT_UNTIL)) : Number.NaN;
  const hourly = num(env.AI_HOURLY_NEURONS, 2_000_000);
  const dailyUsd = num(env.AI_DAILY_USD, 7);
  if (Number.isFinite(until) && at.getTime() < until) {
    return { hourly: num(env.AI_CREDIT_HOURLY_NEURONS, hourly), dailyUsd: num(env.AI_CREDIT_DAILY_USD, dailyUsd), credit: true };
  }
  return { hourly, dailyUsd, credit: false };
}

export async function checkAiUsage(env: Env, at = new Date()): Promise<{ hour: number; day: number; projected: number; alerting: boolean }> {
  const { hourly, dailyUsd } = aiLimits(env, at);
  const midnight = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const [hour, day] = await Promise.all([neuronsSince(env, new Date((at as unknown as number) - 3600e3)), neuronsSince(env, midnight)]);

  // Project today's spend from the rate so far; the first hour counts as a full hour to avoid wild guesses.
  const hoursSoFar = Math.max(1, ((at as unknown as number) - (midnight as unknown as number)) / 3600e3);
  const projected = (day / hoursSoFar) * 24 * (USD_PER_1K_NEURONS / 1000);
  const reasons: string[] = [];
  if (hour > hourly) reasons.push(`${Math.round(hour).toLocaleString("en-GB")} neurons in the last hour (limit ${hourly.toLocaleString("en-GB")})`);
  if (projected > dailyUsd) reasons.push(`on track for ${projected.toFixed(2)} USD today (limit ${dailyUsd} USD)`);

  const ts = Math.floor((at as unknown as number) / 1000);
  const open = await env.DB.prepare("SELECT id, started_at FROM incidents WHERE app = 'ai-usage' AND resolved_at IS NULL ORDER BY id DESC LIMIT 1").first<{ id: number; started_at: number }>();
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

const actorOf = (e: AuditEvent): string => e.actor?.email || e.actor?.token_name || e.actor?.type || "someone";

export async function checkAccessChanges(env: Env, at = new Date()): Promise<{ changes: number }> {
  // Audit entries can show up a little late, so read up to two minutes ago and continue from there next time.
  const before = new Date((at as unknown as number) - 120e3).toISOString();
  const since = await getKey(env, "audit_since");
  if (!since) {
    await setKey(env, "audit_since", before); // first run: start from now, don't replay history
    return { changes: 0 };
  }
  const products = String(env.ACCESS_WATCH_PRODUCTS || "access").split(",").map((s) => s.trim()).filter(Boolean);
  const events: AuditEvent[] = [];
  for (const product of products) {
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({ since, before, resource_product: product, "action_type.not": "view", limit: "100", direction: "asc" });
      if (cursor) q.set("cursor", cursor);
      const j = await cf(env, `/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID!)}/logs/audit?${q}`);
      events.push(...(j.result || []));
      cursor = j.result_info?.cursor;
      if (!cursor || !(j.result || []).length) break;
    }
  }
  if (events.length) {
    const lines = events.slice(0, 8).map((e) => `${e.action?.description || `${e.action?.type} ${e.resource?.type}`} by ${actorOf(e)}`);
    const more = events.length > lines.length ? ` and ${events.length - lines.length} more` : "";
    const summary = lines.join("; ") + more;
    const ts = Math.floor((at as unknown as number) / 1000);
    await env.DB.prepare("INSERT INTO incidents (app, started_at, resolved_at, error) VALUES ('access-changes', ?, ?, ?)").bind(ts, ts, summary.slice(0, 900)).run();
    await alert(env, `🔐 ${events.length} Access change${events.length === 1 ? "" : "s"}: ${summary}`);
  }
  await setKey(env, "audit_since", before);
  return { changes: events.length };
}

const FAILED = new Set(["fail", "terminated"]);

/** A build counts when it ran for a branch its trigger names explicitly (production), not for a preview pattern. */
const isProduction = (b: Build): boolean => {
  const branch = b.build_trigger_metadata?.branch;
  return !!branch && (b.trigger?.branch_includes || []).includes(branch);
};

export async function checkBuilds(env: Env, at = new Date()): Promise<{ failed: number }> {
  const account = encodeURIComponent(env.CF_ACCOUNT_ID!);
  let scripts: { id: string; tag: string }[];
  let latest: Record<string, Build>;
  try {
    scripts = (await cf(env, `/accounts/${account}/workers/scripts`)).result || [];
    if (!scripts.length) return { failed: 0 };
    // The endpoint takes at most 20 script ids per request.
    latest = {};
    for (let i = 0; i < scripts.length; i += 20) {
      const q = new URLSearchParams({ external_script_ids: scripts.slice(i, i + 20).map((s) => s.tag).join(",") });
      const r = (await cf(env, `/accounts/${account}/builds/builds/latest?${q}`)).result || {};
      Object.assign(latest, r.builds || r);
    }
  } catch (e) {
    if (!/answered 40[13]/.test(String((e as Error)?.message))) throw e;
    // The token lacks Workers Scripts Read or Workers CI Read (the builds API answers 401 or 403): say so once instead of failing every run.
    if (!(await getKey(env, "builds_denied"))) {
      await setKey(env, "builds_denied", at.toISOString());
      await alert(env, "⚠️ field can't read Workers Builds: give CF_API_TOKEN Workers Scripts Read and Workers CI Read to get alerts for failed deploys");
    }
    return { failed: 0 };
  }

  const ts = Math.floor((at as unknown as number) / 1000);
  let failed = 0;
  for (const s of scripts) {
    const b = latest[s.tag];
    if (!b?.build_uuid || b.status !== "stopped" || !isProduction(b)) continue;
    const key = `build:${s.id}`;
    const prev = JSON.parse((await getKey(env, key)) || "null") as { uuid: string; incident: number } | null;
    const meta = b.build_trigger_metadata || {};
    const commit = `${(meta.commit_hash || "").slice(0, 7)} ${(meta.commit_message || "").split("\n")[0]}`.trim().slice(0, 120);
    if (FAILED.has(String(b.build_outcome))) {
      failed++;
      if (prev?.uuid === b.build_uuid) continue;
      const error = `${s.id}: ${b.build_outcome} on ${meta.branch}${commit ? ` (${commit})` : ""}`;
      const res = await env.DB.prepare("INSERT INTO incidents (app, started_at, error) VALUES ('builds', ?, ?)").bind(ts, error).run();
      if (prev?.incident) await env.DB.prepare("UPDATE incidents SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL").bind(ts, prev.incident).run();
      await setKey(env, key, JSON.stringify({ uuid: b.build_uuid, incident: res.meta.last_row_id }));
      await alert(env, `🔴 Deploy failed for ${s.id} (${b.trigger?.trigger_name || meta.branch}): build ${b.build_outcome}${commit ? `, commit ${commit}` : ""}. The previous version keeps running.`);
    } else if (b.build_outcome === "success" && prev) {
      await env.DB.prepare("UPDATE incidents SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL").bind(ts, prev.incident).run();
      await env.DB.prepare("DELETE FROM watch WHERE key = ?").bind(key).run();
      await alert(env, `🟢 ${s.id} deploys again${commit ? ` (${commit})` : ""}`);
    }
  }
  return { failed };
}

/** Called from the cron. Errors are logged, never thrown, so health checks keep running. */
export async function runWatchers(env: Env, at = new Date()): Promise<void> {
  if (!watchEnabled(env)) return;
  const jobs: Promise<unknown>[] = [checkAccessChanges(env, at), checkBuilds(env, at)];
  if (at.getUTCMinutes() < 5) jobs.push(checkAiUsage(env, at));
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status !== "rejected") continue;
    console.error("watcher failed", r.reason);
    await phException(env, null, r.reason, { job: "watcher" });
  }
}
