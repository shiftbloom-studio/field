// Shared Miniflare setup: field plus fake app Workers behind its service bindings,
// and app databases seeded with the same schema the real apps use.
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare } from "miniflare";

const sql = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

export const APPS = [
  { id: "drop", name: "drop", url: "https://drop.test", service: "DROP", health: "/health", db: "DROP_DB", adapter: "drop" },
  { id: "convert", name: "convert", url: "https://convert.test", service: "CONVERT", health: "/api/health", db: "CONVERT_DB", adapter: "convert" },
  { id: "grow", name: "grow", url: "https://grow.test", service: "GROW", health: "/healthz", db: "GROW_DB", adapter: "grow" },
  { id: "roots", name: "roots", url: "https://roots.test", service: "ROOTS", health: "/", expect: [401], db: "ROOTS_DB", adapter: "roots" },
  { id: "petal", name: "petal", url: "https://chat.test", service: "PETAL", health: "/health" },
  { id: "runners", name: "runners", status: "planned" },
];

export async function boot(extra = {}) {
  const deleted = [];
  const mf = new Miniflare({
    ...extra,
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    scriptPath: process.env.FIELD_SCRIPT || new URL("../src/index.js", import.meta.url).pathname,
    compatibilityDate: "2026-07-01",
    d1Databases: ["DB", "DROP_DB", "CONVERT_DB", "GROW_DB", "ROOTS_DB"],
    r2Buckets: ["CONVERT_FILES"],
    queueProducers: { ROOTS_QUEUE: "roots-index" },
    bindings: { APPS, LINKS: [{ name: "GitHub", url: "https://github.com" }], DEV_BYPASS_ACCESS: "true", TZ: "Europe/Berlin", OPERATOR: { name: "Test Operator", street: "Example Street 1", city: "12345 Example City", email: "operator@example.org", authority: { en: "Example Authority", de: "Beispielbehörde" } }, ...extra.bindings },
    serviceBindings: {
      DROP: async (req) => {
        const u = new URL(req.url);
        if (u.pathname === "/health") return Response.json({ ok: true });
        if (u.pathname.startsWith("/d/")) { deleted.push(u.pathname); return new Response("deleted"); }
        return new Response("nope", { status: 404 });
      },
      CONVERT: async () => Response.json({ ok: true }),
      GROW: async () => new Response("broken", { status: 500 }),
      ROOTS: async () => new Response("Unauthorized", { status: 401 }),
      PETAL: async () => new Response("ok"),
    },
  });
  const env = await mf.getBindings();
  for (const f of readdirSync(new URL("../migrations/", import.meta.url))) await env.DB.exec(sql(`../migrations/${f}`).replace(/--.*\n/g, "").replace(/\n/g, " ").replace(/;\s*/g, ";\n"));
  const ex = (db, s) => db.exec(s.replace(/\n/g, " "));
  await ex(env.DROP_DB, "CREATE TABLE items (id TEXT PRIMARY KEY, kind TEXT, r2_key TEXT, name TEXT, mime TEXT, size INTEGER, target TEXT, lang TEXT, created_at INTEGER, expires_at INTEGER, delete_token TEXT, thumb_key TEXT, alt TEXT, nsfw INTEGER, views INTEGER DEFAULT 0)");
  await ex(env.DROP_DB, `INSERT INTO items VALUES ('AbC12','file','f/AbC12/cat.jpg','cat.jpg','image/jpeg',457606,NULL,NULL,${Math.floor(Date.now() / 1000)},NULL,'tok123',NULL,'a cat',0,3)`);
  await ex(env.CONVERT_DB, "CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT, engine TEXT, status TEXT, progress INTEGER, step TEXT, input_name TEXT, input_key TEXT, output_key TEXT, output_name TEXT, output_type TEXT, output_size INTEGER, stream_uid TEXT, options TEXT, error TEXT, ip_hash TEXT, created_at INTEGER, updated_at INTEGER)");
  await ex(env.CONVERT_DB, "CREATE TABLE usage (day TEXT, subject TEXT, units INTEGER, PRIMARY KEY (day, subject))");
  await ex(env.CONVERT_DB, `INSERT INTO jobs VALUES ('11111111-2222-3333-4444-555555555555','video','media','failed',40,'x','a.mov','in/x','out/x',NULL,NULL,NULL,NULL,NULL,'boom','h',${Date.now()},${Date.now()})`);
  await ex(env.CONVERT_DB, `INSERT INTO usage VALUES ('${new Date().toISOString().slice(0, 10)}','ip:abc',12)`);
  await ex(env.GROW_DB, "CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT, admin_key_hash TEXT, overlay_key TEXT, twitch_user_id TEXT, twitch_login TEXT, created_at INTEGER, last_seen_at INTEGER)");
  await ex(env.GROW_DB, "CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, channel_id TEXT, created_at INTEGER, expires_at INTEGER)");
  await ex(env.GROW_DB, `INSERT INTO channels VALUES ('ch1','My <b>channel</b>','h','o',NULL,NULL,${Date.now()},${Date.now()})`);
  await ex(env.GROW_DB, `INSERT INTO sessions VALUES ('t','ch1',${Date.now()},${Date.now() + 1e9})`);
  await ex(env.ROOTS_DB, "CREATE TABLE documents (key TEXT PRIMARY KEY, doc_id TEXT, source TEXT, title TEXT, url TEXT, hash TEXT, size INTEGER, chunks INTEGER, kind TEXT, indexed_at TEXT)");
  await ex(env.ROOTS_DB, "CREATE TABLE sources (name TEXT PRIMARY KEY, kind TEXT, repo TEXT, branch TEXT, description TEXT, last_sync TEXT, last_commit TEXT, files INTEGER, status TEXT)");
  await ex(env.ROOTS_DB, `INSERT INTO sources VALUES ('github/petal','github','org/petal','main',NULL,'${new Date().toISOString()}',NULL,10,'synced')`);
  return { mf, env, deleted };
}
