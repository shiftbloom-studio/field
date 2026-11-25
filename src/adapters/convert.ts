// convert: file conversion jobs. Timestamps in convert's D1 are unix milliseconds.

import type { Adapter, Env, Row } from "../types.ts";

type Counts = Record<string, number | null>;

const db = (env: Env) => env.CONVERT_DB!;
const DAY = 86400_000;

export default {
  binds: ["CONVERT_DB"],

  async stats(env) {
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    const s = (await db(env).prepare(
      `SELECT SUM(created_at >= ?1 - ${DAY}) AS day,
              SUM(status NOT IN ('done', 'failed', 'error') AND created_at >= ?1 - ${DAY}) AS running,
              SUM(status IN ('failed', 'error') AND created_at >= ?1 - ${DAY}) AS failed,
              COALESCE(SUM(CASE WHEN created_at >= ?1 - ${DAY} THEN output_size END), 0) AS bytes,
              COUNT(*) AS total
         FROM jobs`,
    ).bind(now).first<Counts>())!;
    const u = (await db(env).prepare("SELECT COALESCE(SUM(units), 0) AS units, COUNT(*) AS subjects FROM usage WHERE day = ?").bind(today).first<Counts>())!;
    return [
      { label: "jobs in 24 h", value: s.day || 0, hint: `${s.total || 0} stored` },
      { label: "running", value: s.running || 0 },
      { label: "failed", value: s.failed || 0, warn: (s.failed || 0) > 0 },
      { label: "output in 24 h", value: s.bytes, type: "size" },
      { label: "quota used today", value: u.units, hint: `${u.subjects} counters` },
    ];
  },

  async panel(env, app, params) {
    const status = params.get("status") || "";
    const where = status === "failed" ? "WHERE status IN ('failed','error')" : status === "running" ? "WHERE status NOT IN ('done','failed','error')" : "";
    const jobs = await db(env).prepare(
      `SELECT id, kind, engine, status, progress, step, input_name, output_name, output_size, error, created_at, updated_at
         FROM jobs ${where} ORDER BY created_at DESC LIMIT 60`,
    ).all();
    const usage = await db(env).prepare("SELECT day, subject, units FROM usage ORDER BY day DESC, units DESC LIMIT 60").all();
    return {
      filters: [{ name: "status", type: "select", options: [["", "all jobs"], ["running", "running"], ["failed", "failed"]] }],
      tables: [
        {
          title: "jobs",
          empty: "No jobs yet.",
          columns: [
            { key: "id", label: "id", type: "mono", render: (r: Row) => r.id.slice(0, 8) },
            { key: "kind", label: "kind", type: "tag" },
            { key: "engine", label: "engine", type: "mono" },
            { key: "status", label: "status", type: "status" },
            { key: "input_name", label: "file", render: (r: Row) => r.output_name ? `${r.input_name || "?"} → ${r.output_name}` : r.input_name || "" },
            { key: "output_size", label: "result", type: "size" },
            { key: "created_at", label: "started", type: "time_ms" },
            { key: "error", label: "error", type: "muted" },
          ],
          rows: jobs.results,
          rowActions: [{ action: "delete-job", label: "delete", confirm: "Delete this job and its files?", danger: true }],
        },
        {
          title: "daily quotas",
          note: "Counters per day, per IP hash or global. Resetting one lifts the limit for the rest of the day.",
          empty: "Nothing used yet.",
          key: (r: Row) => `${r.day}|${r.subject}`,
          columns: [
            { key: "day", label: "day", type: "mono" },
            { key: "subject", label: "counter", type: "mono" },
            { key: "units", label: "used", type: "num" },
          ],
          rows: usage.results,
          rowActions: [{ action: "reset-usage", label: "reset", confirm: "Reset this counter to zero?" }],
        },
      ],
    };
  },

  actions: {
    async "delete-job"(env, app, form) {
      const id = String(form.get("id") || "");
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("invalid id");
      const job = await db(env).prepare("SELECT id, input_key, output_key FROM jobs WHERE id = ?").bind(id).first<{ id: string; input_key: string | null; output_key: string | null }>();
      if (!job) throw new Error("job no longer exists");
      if (env.CONVERT_FILES) {
        const keys = [job.input_key, job.output_key, `in/${id}`].filter(Boolean) as string[];
        await env.CONVERT_FILES.delete(keys);
      }
      await db(env).prepare("DELETE FROM jobs WHERE id = ?").bind(id).run();
      return { target: id, message: `deleted job ${id.slice(0, 8)}` };
    },
    async "reset-usage"(env, app, form) {
      const [day, subject] = String(form.get("id") || "").split("|");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || !subject) throw new Error("invalid counter");
      await db(env).prepare("DELETE FROM usage WHERE day = ? AND subject = ?").bind(day, subject).run();
      return { target: `${day} ${subject}`, message: `reset counter ${subject}` };
    },
  },
} satisfies Adapter;
