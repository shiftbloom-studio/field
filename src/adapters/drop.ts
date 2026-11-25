// drop: uploads, pastes and short links. Reads drop's D1 directly; deletes go through
// drop's own /d/<id>/<token> route so R2 objects, thumbnails and KV links disappear together.

import { randomToken, sha256Hex } from "../tokens.ts";
import type { Adapter, Env, Row, Table, Tile, TokenRow } from "../types.ts";

type Counts = Record<string, number | null>;

const db = (env: Env) => env.DROP_DB!;

export default {
  binds: ["DROP_DB"],

  async stats(env) {
    const now = Math.floor(Date.now() / 1000);
    const s = (await db(env).prepare(
      `SELECT COUNT(*) AS n,
              SUM(kind = 'file') AS files, SUM(kind = 'paste') AS pastes, SUM(kind = 'link') AS links,
              COALESCE(SUM(size), 0) AS bytes, COALESCE(SUM(views), 0) AS views,
              SUM(nsfw = 1) AS nsfw,
              SUM(expires_at IS NOT NULL AND expires_at < ?1 + 86400) AS expiring,
              SUM(created_at >= ?1 - 86400) AS today
         FROM items`,
    ).bind(now).first<Counts>())!;
    return [
      { label: "items", value: s.n, hint: `${s.files || 0} files · ${s.pastes || 0} pastes · ${s.links || 0} links` },
      { label: "storage", value: s.bytes, type: "size" },
      { label: "views", value: s.views },
      { label: "new in 24 h", value: s.today || 0 },
      { label: "flagged nsfw", value: s.nsfw || 0, warn: (s.nsfw || 0) > 0 },
      { label: "expire in 24 h", value: s.expiring || 0 },
      ...(await waitingRequests(env)),
    ];
  },

  async panel(env, app, params) {
    const where: string[] = [];
    const binds: string[] = [];
    const q = (params.get("q") || "").trim();
    const kind = params.get("kind") || "";
    if (q) { where.push("(id LIKE ? OR name LIKE ? OR alt LIKE ?)"); binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (["file", "paste", "link"].includes(kind)) { where.push("kind = ?"); binds.push(kind); }
    if (params.get("nsfw") === "1") where.push("nsfw = 1");
    const { results } = await db(env).prepare(
      `SELECT id, kind, name, mime, size, target, views, nsfw, alt, created_at, expires_at
         FROM items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 60`,
    ).bind(...binds).all();
    const base = (app.url || "").replace(/\/$/, "");
    const requests = await requestTable(env);
    return {
      filters: [
        { name: "q", type: "search", placeholder: "id, file name or alt text" },
        { name: "kind", type: "select", options: [["", "all kinds"], ["file", "files"], ["paste", "pastes"], ["link", "links"]] },
        { name: "nsfw", type: "check", label: "nsfw only" },
      ],
      tables: [{
        title: "items",
        empty: "No items found.",
        columns: [
          { key: "id", label: "id", type: "link", href: (r: Row) => `${base}/${r.id}` },
          { key: "kind", label: "kind", type: "tag" },
          { key: "name", label: "name", render: (r: Row) => r.kind === "link" ? r.target : r.name || r.alt || "" },
          { key: "size", label: "size", type: "size" },
          { key: "views", label: "views", type: "num" },
          { key: "created_at", label: "uploaded", type: "time" },
          { key: "expires_at", label: "expires", type: "time", none: "never" },
          { key: "nsfw", label: "", type: "flag", text: "nsfw" },
        ],
        rows: results,
        rowActions: [{ action: "delete", label: "delete", confirm: "Delete this item for good?", danger: true }],
      }, ...(requests ? [requests] : [])],
    };
  },

  actions: {
    async delete(env, app, form) {
      const id = String(form.get("id") || "");
      if (!/^[A-Za-z0-9]{3,16}$/.test(id)) throw new Error("invalid id");
      const it = await db(env).prepare("SELECT id, delete_token FROM items WHERE id = ?").bind(id).first<{ id: string; delete_token: string }>();
      if (!it) throw new Error("item no longer exists");
      const svc = (app.service && env[app.service]) as Fetcher | undefined | "";
      if (!svc) throw new Error("service binding to drop is missing");
      const res = await svc.fetch(new Request(`${app.url || "https://drop.invalid"}/d/${it.id}/${it.delete_token}`, { method: "DELETE" }));
      if (!res.ok) throw new Error(`drop answered with HTTP ${res.status}`);
      return { target: id, message: `deleted ${id}` };
    },
    "approve-request": (env, app, form) => decide(env, form, "approved", 90),
    "approve-request-year": (env, app, form) => decide(env, form, "approved", 365),
    "reject-request": (env, app, form) => decide(env, form, "rejected"),
  },

  // Named API tokens in drop's api_tokens table (drop migration 0004). drop refuses them once
  // expired or revoked; its API_TOKEN secret stays the owner's master token.
  tokens: {
    binds: ["DROP_DB"],
    ownerLabel: "created by",
    about: "For ShareX, scripts and other devices. Each token has its own label and expiry, so you can revoke one without touching the others.",
    async list(env) {
      const { results } = await db(env).prepare(
        "SELECT id, label, prefix, created_by AS owner, created_at, expires_at, last_used_at, revoked_at FROM api_tokens ORDER BY revoked_at IS NOT NULL, created_at DESC LIMIT 200",
      ).all<TokenRow>();
      return results;
    },
    async create(env, { label, expiresAt, user }) {
      const secret = randomToken("drop_");
      const id = randomToken("", 16, "0123456789abcdef");
      await db(env).prepare(
        "INSERT INTO api_tokens (id, label, prefix, hash, created_at, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, label, secret.slice(0, 12), await sha256Hex(secret), Math.floor(Date.now() / 1000), user?.email || null, expiresAt).run();
      return {
        id, secret, prefix: secret.slice(0, 12),
        usage: "Send it as Authorization: Bearer <token> or X-API-Key. In drop's web UI, paste it into the token field and download the ShareX configs from there; they carry this token.",
      };
    },
    async revoke(env, id) {
      if (!/^[0-9a-f]{16}$/.test(id)) throw new Error("invalid token id");
      const r = await db(env).prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Math.floor(Date.now() / 1000), id).run();
      return r.meta?.changes ?? 0;
    },
  },
} satisfies Adapter;

// Token requests from drop's public form (drop migration 0005). field only decides; drop generates
// the token when the requester collects it through their private link, so field never sees it.
const DAY = 86400;

async function hasRequests(env: Env): Promise<boolean> {
  const t = await db(env).prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'token_requests'").first();
  return !!t;
}

async function waitingRequests(env: Env): Promise<Tile[]> {
  if (!(await hasRequests(env))) return [];
  const r = (await db(env).prepare("SELECT COUNT(*) AS n FROM token_requests WHERE status = 'pending'").first<{ n: number }>())!;
  return [{ label: "token requests", value: r.n || 0, hint: "waiting for a decision", warn: (r.n || 0) > 0 }];
}

async function requestTable(env: Env): Promise<Table | null> {
  if (!(await hasRequests(env))) return null;
  const { results } = await db(env).prepare(
    `SELECT id, name, reason, status, created_at, decided_at, token_expires_at FROM token_requests
      ORDER BY status = 'pending' DESC, created_at DESC LIMIT 50`,
  ).all();
  return {
    title: "token requests",
    note: "People who asked for an upload token on drop. Approving lets them collect a token once through their private link, within 14 days. You can revoke it under API tokens like any other.",
    empty: "No requests.",
    columns: [
      { key: "name", label: "name" },
      { key: "reason", label: "wants to upload" },
      { key: "status", label: "status", type: "tag" },
      { key: "created_at", label: "asked", type: "time" },
      { key: "token_expires_at", label: "token expires", type: "time", none: "" },
    ],
    rows: results,
    rowActions: [
      { action: "approve-request", label: "approve, 90 days", when: (r: Row) => r.status === "pending" },
      { action: "approve-request-year", label: "approve, 1 year", when: (r: Row) => r.status === "pending" },
      { action: "reject-request", label: "reject", confirm: "Reject this request?", danger: true, when: (r: Row) => r.status === "pending" },
    ],
  };
}

async function decide(env: Env, form: FormData, status: string, days?: number) {
  const id = String(form.get("id") || "");
  if (!/^[A-Za-z0-9]{6,32}$/.test(id)) throw new Error("invalid request id");
  const now = Math.floor(Date.now() / 1000);
  const r = await db(env).prepare(
    `UPDATE token_requests SET status = ?, decided_at = ?, label = 'request: ' || name, token_expires_at = ?
      WHERE id = ? AND status = 'pending'`,
  ).bind(status, now, days ? now + days * DAY : null, id).run();
  if (!(r.meta?.changes ?? 0)) throw new Error("request was already decided or no longer exists");
  return { target: id, message: status === "approved" ? `approved request ${id}, token valid for ${days} days once collected` : `rejected request ${id}` };
}
