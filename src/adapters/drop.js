// drop: uploads, pastes and short links. Reads drop's D1 directly; deletes go through
// drop's own /d/<id>/<token> route so R2 objects, thumbnails and KV links disappear together.

const db = (env) => env.DROP_DB;

export default {
  binds: ["DROP_DB"],

  async stats(env) {
    const now = Math.floor(Date.now() / 1000);
    const s = await db(env).prepare(
      `SELECT COUNT(*) AS n,
              SUM(kind = 'file') AS files, SUM(kind = 'paste') AS pastes, SUM(kind = 'link') AS links,
              COALESCE(SUM(size), 0) AS bytes, COALESCE(SUM(views), 0) AS views,
              SUM(nsfw = 1) AS nsfw,
              SUM(expires_at IS NOT NULL AND expires_at < ?1 + 86400) AS expiring,
              SUM(created_at >= ?1 - 86400) AS today
         FROM items`,
    ).bind(now).first();
    return [
      { label: "items", value: s.n, hint: `${s.files || 0} files · ${s.pastes || 0} pastes · ${s.links || 0} links` },
      { label: "storage", value: s.bytes, type: "size" },
      { label: "views", value: s.views },
      { label: "new in 24 h", value: s.today || 0 },
      { label: "flagged nsfw", value: s.nsfw || 0, warn: (s.nsfw || 0) > 0 },
      { label: "expire in 24 h", value: s.expiring || 0 },
    ];
  },

  async panel(env, app, params) {
    const where = [];
    const binds = [];
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
          { key: "id", label: "id", type: "link", href: (r) => `${base}/${r.id}` },
          { key: "kind", label: "kind", type: "tag" },
          { key: "name", label: "name", render: (r) => r.kind === "link" ? r.target : r.name || r.alt || "" },
          { key: "size", label: "size", type: "size" },
          { key: "views", label: "views", type: "num" },
          { key: "created_at", label: "uploaded", type: "time" },
          { key: "expires_at", label: "expires", type: "time", none: "never" },
          { key: "nsfw", label: "", type: "flag", text: "nsfw" },
        ],
        rows: results,
        rowActions: [{ action: "delete", label: "delete", confirm: "Delete this item for good?", danger: true }],
      }],
    };
  },

  actions: {
    async delete(env, app, form) {
      const id = String(form.get("id") || "");
      if (!/^[A-Za-z0-9]{3,16}$/.test(id)) throw new Error("invalid id");
      const it = await db(env).prepare("SELECT id, delete_token FROM items WHERE id = ?").bind(id).first();
      if (!it) throw new Error("item no longer exists");
      const svc = app.service && env[app.service];
      if (!svc) throw new Error("service binding to drop is missing");
      const res = await svc.fetch(new Request(`${app.url || "https://drop.invalid"}/d/${it.id}/${it.delete_token}`, { method: "DELETE" }));
      if (!res.ok) throw new Error(`drop answered with HTTP ${res.status}`);
      return { target: id, message: `deleted ${id}` };
    },
  },
};
