// rhizome: long-horizon memory for AI agents. field reads and writes rhizome's control
// database (rhizome-control) for clients and API keys; memory content never passes through here.
// Keys follow rhizome's own format: "rz_" + 32 base36 characters, SHA-256 hex in api_keys.hash,
// times in epoch milliseconds (rhizome migration 0002 adds label and expires_at).
import { randomToken, sha256Hex } from "../tokens.ts";
import type { Adapter, Env, TokenRow, User } from "../types.ts";

const db = (env: Env) => env.RHIZOME_DB!;
const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const SLUG = /^[a-z0-9][a-z0-9._-]{0,47}$/; // same rule as rhizome's scopes.ts
// rhizome's DEFAULT_GRANTS: shared profile and projects, plus the agent's own scope.
const DEFAULT_GRANTS = { read: ["profile", "project:*", "agent:self"], write: ["profile", "project:*", "agent:self"] };
const PROVIDERS = ["anthropic", "openai", "google", "mistral", "nous", "cursor", "local"];

/** rhizome's id format: 9 chars of base36 milliseconds + 12 random base36 chars. */
function newId(): string {
  return Date.now().toString(36).padStart(9, "0") + randomToken("", 12, BASE36);
}

/**
 * The rhizome people a field user may mint and manage keys for. Owners: everyone.
 * Members: only the person linked to their own Access email, because a key for someone
 * else's client reads that person's memory. No linked person means no keys at all.
 */
async function peopleFor(env: Env, user: User): Promise<{ id: string; name: string }[]> {
  if (user.owner) return (await db(env).prepare("SELECT id, name FROM users ORDER BY created_at").all<{ id: string; name: string }>()).results;
  return (await db(env).prepare("SELECT id, name FROM users WHERE email IS NOT NULL AND lower(email) = lower(?)").bind(user.email).all<{ id: string; name: string }>()).results;
}

/** SQL filter on clients c for a member, or "1" for owners; binds are appended in order. */
const scope = (user: User): [string, unknown[]] =>
  user.owner ? ["1", []] : ["c.user_id IN (SELECT id FROM users WHERE email IS NOT NULL AND lower(email) = lower(?))", [user.email]];

/** Finds or creates the client for agent + provider of one person. */
async function ensureClient(env: Env, form: FormData, user: User): Promise<{ id: string; name: string }> {
  const agent = String(form.get("agent") || "").trim().toLowerCase();
  const provider = String(form.get("provider") || "").trim().toLowerCase();
  if (!SLUG.test(agent)) throw new Error("Agent must be a lowercase slug, e.g. claude-code or hermes.");
  if (!SLUG.test(provider)) throw new Error("Provider must be a lowercase slug, e.g. anthropic or openai.");
  const users = await peopleFor(env, user);
  if (!users.length) throw new Error("No rhizome memory is linked to your email yet.");
  const userId = String(form.get("person") || "") || (users.length === 1 ? users[0].id : "");
  if (!users.some((u) => u.id === userId)) throw new Error("Pick the person this agent works for.");
  const existing = await db(env).prepare("SELECT id, name FROM clients WHERE user_id = ? AND agent = ? AND provider = ? AND revoked_at IS NULL").bind(userId, agent, provider).first<{ id: string; name: string }>();
  if (existing) return existing;
  const client = { id: newId(), name: `${agent} (${provider})` };
  await db(env).prepare("INSERT INTO clients (id, user_id, name, agent, provider, grants, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(client.id, userId, client.name, agent, provider, JSON.stringify(DEFAULT_GRANTS), Date.now()).run();
  return client;
}

const sec = (ms: number | null | undefined): number | null => (ms == null ? null : Math.floor(ms / 1000));

async function activeClients(env: Env, user: User): Promise<{ id: string; name: string; agent: string; provider: string; user: string }[]> {
  const [where, binds] = scope(user);
  const { results } = await db(env).prepare(
    `SELECT c.id, c.name, c.agent, c.provider, u.name AS user
       FROM clients c JOIN users u ON u.id = c.user_id
      WHERE c.revoked_at IS NULL AND ${where} ORDER BY u.name, c.name`,
  ).bind(...binds).all<{ id: string; name: string; agent: string; provider: string; user: string }>();
  return results;
}

export default {
  binds: ["RHIZOME_DB"],

  async stats(env) {
    const now = Date.now();
    const s = (await db(env).prepare(
      `SELECT (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM clients WHERE revoked_at IS NULL) AS clients,
              (SELECT COUNT(*) FROM api_keys WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?1)) AS keys,
              (SELECT MAX(last_used_at) FROM api_keys) AS last`,
    ).bind(now).first<Record<string, number | null>>())!;
    return [
      { label: "people", value: s.users || 0 },
      { label: "agent clients", value: s.clients || 0 },
      { label: "active keys", value: s.keys || 0 },
      { label: "last key use", value: sec(s.last), type: "time" },
    ];
  },

  async panel(env, _app, _params, user) {
    const [where, binds] = scope(user);
    const { results } = await db(env).prepare(
      `SELECT c.id, c.name, c.agent, c.provider, u.name AS user, c.created_at, c.revoked_at,
              (SELECT COUNT(*) FROM api_keys k WHERE k.client_id = c.id AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > ?)) AS keys
         FROM clients c JOIN users u ON u.id = c.user_id WHERE ${where} ORDER BY c.revoked_at IS NOT NULL, u.name, c.name`,
    ).bind(Date.now(), ...binds).all();
    return {
      tables: [{
        title: "agent clients",
        note: "One client per agent and provider. Pick “new agent” above to add one together with its first key.",
        empty: "No clients yet.",
        columns: [
          { key: "name", label: "client" },
          { key: "agent", label: "agent", type: "mono" },
          { key: "provider", label: "provider", type: "tag" },
          { key: "user", label: "person" },
          { key: "keys", label: "active keys", type: "num" },
          { key: "created_at", label: "created", type: "time_ms" },
          { key: "revoked_at", label: "revoked", type: "time_ms", none: "–" },
        ],
        rows: results,
      }],
    };
  },

  actions: {},

  tokens: {
    binds: ["RHIZOME_DB"],
    ownerLabel: "client",
    about: "Each key belongs to one agent client and only sees the scopes that client is granted: the shared profile, all projects and the agent's own scope. A client can hold several keys, e.g. one per machine.",
    async fields(env, _app, user) {
      const [clients, users] = await Promise.all([activeClients(env, user), peopleFor(env, user)]);
      const isNew = { field: "client", value: "new" };
      return [
        { name: "client", label: "agent", type: "select", required: true, options: [...clients.map((c): [string, string] => [c.id, `${c.name} · ${c.user}`]), ["new", "new agent…"]] },
        { name: "agent", label: "agent slug", type: "text", placeholder: "e.g. claude-code", when: isNew },
        { name: "provider", label: "provider", type: "text", placeholder: "e.g. anthropic", suggest: PROVIDERS, when: isNew },
        ...(users.length > 1 ? [{ name: "person", label: "for", type: "select" as const, options: users.map((u): [string, string] => [u.id, u.name]), when: isNew }] : []),
      ];
    },
    async list(env, _app, user) {
      const [where, binds] = scope(user);
      const { results } = await db(env).prepare(
        `SELECT k.rowid AS id, COALESCE(k.label, '') AS label, k.prefix, c.name AS owner,
                k.created_at, k.expires_at, k.last_used_at, COALESCE(k.revoked_at, c.revoked_at) AS revoked_at
           FROM api_keys k JOIN clients c ON c.id = k.client_id
          WHERE ${where}
          ORDER BY COALESCE(k.revoked_at, c.revoked_at) IS NOT NULL, k.created_at DESC LIMIT 200`,
      ).bind(...binds).all<TokenRow>();
      return results.map((r) => ({ ...r, created_at: sec(r.created_at), expires_at: sec(r.expires_at), last_used_at: sec(r.last_used_at), revoked_at: sec(r.revoked_at) }));
    },
    async create(env, { label, expiresAt, form, user }) {
      const clientId = String(form.get("client") || "");
      const [where, binds] = scope(user);
      const client = clientId === "new"
        ? await ensureClient(env, form, user)
        : await db(env).prepare(`SELECT c.id, c.name FROM clients c WHERE c.id = ? AND c.revoked_at IS NULL AND ${where}`).bind(clientId, ...binds).first<{ id: string; name: string }>();
      if (!client) throw new Error("Pick an active client for the key.");
      const secret = randomToken("rz_", 32, BASE36);
      const r = await db(env).prepare(
        "INSERT INTO api_keys (hash, prefix, client_id, created_at, label, expires_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING rowid AS id",
      ).bind(await sha256Hex(secret), secret.slice(0, 10), client.id, Date.now(), label, expiresAt == null ? null : expiresAt * 1000).first<{ id: number }>();
      return {
        id: String(r!.id), secret, prefix: secret.slice(0, 10), owner: client.name,
        usage: "Send it as Authorization: Bearer <key> to rhizome's /v1/memory endpoints.",
      };
    },
    async revoke(env, id, user) {
      if (!/^\d{1,12}$/.test(id)) throw new Error("invalid key id");
      const [where, binds] = scope(user);
      const r = await db(env).prepare(
        `UPDATE api_keys SET revoked_at = ? WHERE rowid = ? AND revoked_at IS NULL
            AND client_id IN (SELECT c.id FROM clients c WHERE ${where})`,
      ).bind(Date.now(), Number(id), ...binds).run();
      return r.meta?.changes ?? 0;
    },
  },
} satisfies Adapter;
