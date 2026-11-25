// leaf: pastebin with server-side highlighting. Reads leaf's D1 directly. Paste text lives in R2
// under p/<id> (raw) and h/<id> (highlighted); a delete removes the row and both objects.
// API tokens use the same api_tokens schema as drop, with a "leaf_" prefix.

import { randomToken, sha256Hex } from "../tokens.ts";
import type { Adapter, Env, Row, TokenRow } from "../types.ts";

type Counts = Record<string, number | null>;

const db = (env: Env) => env.LEAF_DB!;
const ID = /^[A-Za-z0-9]{6,24}$/;

export default {
  binds: ["LEAF_DB"],

  async stats(env) {
    const now = Math.floor(Date.now() / 1000);
    const s = (await db(env).prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes, COALESCE(SUM(views), 0) AS views,
              SUM(owner IS NULL) AS anon, SUM(burn = 1) AS burn,
              SUM(created_at >= ?1 - 86400) AS today,
              SUM(expires_at IS NOT NULL AND expires_at < ?1 + 86400) AS expiring
         FROM pastes`,
    ).bind(now).first<Counts>())!;
    return [
      { label: "pastes", value: s.n || 0, hint: `${s.anon || 0} anonymous · ${s.burn || 0} burn after reading` },
      { label: "text stored", value: s.bytes, type: "size" },
      { label: "views", value: s.views },
      { label: "new in 24 h", value: s.today || 0 },
      { label: "expire in 24 h", value: s.expiring || 0 },
    ];
  },

  async panel(env, app, params) {
    const where: string[] = [];
    const binds: string[] = [];
    const q = (params.get("q") || "").trim();
    if (q) { where.push("(id LIKE ? OR title LIKE ? OR lang LIKE ?)"); binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (params.get("anon") === "1") where.push("owner IS NULL");
    const { results } = await db(env).prepare(
      `SELECT id, title, lang, size, lines, views, burn, owner, created_at, expires_at
         FROM pastes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 60`,
    ).bind(...binds).all();
    const base = (app.url || "").replace(/\/$/, "");
    const canDelete = !!env.LEAF_PASTES;
    return {
      filters: [
        { name: "q", type: "search", placeholder: "id, title or language" },
        { name: "anon", type: "check", label: "anonymous only" },
      ],
      tables: [{
        title: "pastes",
        empty: "No pastes found.",
        // Burn-after-reading pastes are not linked: opening one would destroy it.
        columns: [
          { key: "id", label: "id", type: "link", href: (r: Row) => (r.burn ? null : `${base}/${r.id}`) },
          { key: "title", label: "title", render: (r: Row) => r.title || "" },
          { key: "lang", label: "language", type: "tag" },
          { key: "size", label: "size", type: "size" },
          { key: "lines", label: "lines", type: "num" },
          { key: "views", label: "views", type: "num" },
          { key: "owner", label: "by", render: (r: Row) => (r.owner == null ? "anonymous" : r.owner === "master" ? "master token" : "token") },
          { key: "created_at", label: "created", type: "time" },
          { key: "expires_at", label: "expires", type: "time", none: "never" },
          { key: "burn", label: "", type: "flag", text: "burn" },
        ],
        rows: results,
        rowActions: canDelete ? [{ action: "delete", label: "delete", confirm: "Delete this paste for good?", danger: true }] : [],
      }],
    };
  },

  actions: {
    async delete(env, app, form) {
      const id = String(form.get("id") || "");
      if (!ID.test(id)) throw new Error("invalid id");
      if (!env.LEAF_PASTES) throw new Error("R2 binding LEAF_PASTES is missing");
      const it = await db(env).prepare("SELECT id FROM pastes WHERE id = ?").bind(id).first();
      if (!it) throw new Error("paste no longer exists");
      await db(env).prepare("DELETE FROM pastes WHERE id = ?").bind(id).run();
      await env.LEAF_PASTES.delete([`p/${id}`, `h/${id}`]);
      return { target: id, message: `deleted ${id}` };
    },
  },

  // Named API tokens in leaf's api_tokens table (leaf migration 0001). leaf refuses them once
  // expired or revoked; its API_TOKEN secret stays the owner's master token.
  tokens: {
    binds: ["LEAF_DB"],
    ownerLabel: "created by",
    about: "For scripts, editors and other devices. Token pastes may be larger and live longer than anonymous ones. Each token has its own label and expiry.",
    async list(env) {
      const { results } = await db(env).prepare(
        "SELECT id, label, prefix, created_by AS owner, created_at, expires_at, last_used_at, revoked_at FROM api_tokens ORDER BY revoked_at IS NOT NULL, created_at DESC LIMIT 200",
      ).all<TokenRow>();
      return results;
    },
    async create(env, { label, expiresAt, user }) {
      const secret = randomToken("leaf_");
      const id = randomToken("", 16, "0123456789abcdef");
      await db(env).prepare(
        "INSERT INTO api_tokens (id, label, prefix, hash, created_at, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, label, secret.slice(0, 12), await sha256Hex(secret), Math.floor(Date.now() / 1000), user?.email || null, expiresAt).run();
      return {
        id, secret, prefix: secret.slice(0, 12),
        usage: "Send it as Authorization: Bearer <token> to leaf's /api/pastes, or paste it into the token field on leaf's start page.",
      };
    },
    async revoke(env, id) {
      if (!/^[0-9a-f]{16}$/.test(id)) throw new Error("invalid token id");
      const r = await db(env).prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Math.floor(Date.now() / 1000), id).run();
      return r.meta?.changes ?? 0;
    },
  },
} satisfies Adapter;
