// roots: knowledge base over GitHub repos and docs.
// field can queue syncs by producing to roots' own index queue (same message format roots uses).

const db = (env) => env.ROOTS_DB;

export default {
  binds: ["ROOTS_DB"],

  async stats(env) {
    const d = await db(env).prepare("SELECT COUNT(*) AS docs, COALESCE(SUM(chunks), 0) AS chunks, MAX(indexed_at) AS last FROM documents").first();
    const s = await db(env).prepare("SELECT COUNT(*) AS n, SUM(status LIKE 'syncing%') AS busy, SUM(status LIKE '%error%' OR status LIKE '%fail%') AS bad FROM sources").first();
    return [
      { label: "documents", value: d.docs || 0 },
      { label: "chunks", value: d.chunks || 0 },
      { label: "sources", value: s.n || 0, hint: s.busy ? `${s.busy} syncing right now` : "all idle" },
      { label: "with errors", value: s.bad || 0, warn: (s.bad || 0) > 0 },
      { label: "last indexed", value: d.last ? Math.floor(Date.parse(d.last) / 1000) : null, type: "time" },
    ];
  },

  async panel(env) {
    const { results } = await db(env).prepare(
      `SELECT s.name, s.kind, s.repo, s.branch, s.files, s.status, s.last_sync,
              (SELECT COUNT(*) FROM documents d WHERE d.source = s.name) AS docs
         FROM sources s ORDER BY s.name`,
    ).all();
    return {
      actions: env.ROOTS_QUEUE ? [{ action: "sync-all", label: "sync everything", confirm: "Sync all GitHub sources again?" }] : [],
      tables: [{
        title: "sources",
        empty: "No sources yet.",
        key: (r) => r.name,
        columns: [
          { key: "name", label: "source", type: "mono" },
          { key: "branch", label: "branch", type: "mono", none: "–" },
          { key: "files", label: "files", type: "num" },
          { key: "docs", label: "indexed", type: "num" },
          { key: "status", label: "status", type: "status" },
          { key: "last_sync", label: "last sync", type: "iso" },
        ],
        rows: results,
        rowActions: env.ROOTS_QUEUE ? [{ action: "sync", label: "sync", when: (r) => r.kind === "github" && r.repo }] : [],
      }],
    };
  },

  actions: {
    async sync(env, app, form) {
      const name = String(form.get("id") || "");
      const src = await db(env).prepare("SELECT repo FROM sources WHERE name = ? AND kind = 'github'").bind(name).first();
      if (!src?.repo) throw new Error("source not found");
      await env.ROOTS_QUEUE.send({ type: "sync-repo", repo: src.repo, offset: 0 });
      return { target: src.repo, message: `queued ${src.repo}` };
    },
    async "sync-all"(env) {
      const { results } = await db(env).prepare("SELECT repo FROM sources WHERE kind = 'github' AND repo IS NOT NULL").all();
      if (results.length) await env.ROOTS_QUEUE.sendBatch(results.map((r) => ({ body: { type: "sync-repo", repo: r.repo, offset: 0 } })));
      return { target: "*", message: `queued ${results.length} sources` };
    },
  },
};
