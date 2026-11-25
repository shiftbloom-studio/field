// grow: hosted OBS to-do overlays. Timestamps in grow's D1 are unix milliseconds.

const db = (env) => env.GROW_DB;

export default {
  binds: ["GROW_DB"],

  async stats(env) {
    const now = Date.now();
    const s = await db(env).prepare(
      `SELECT COUNT(*) AS n, SUM(last_seen_at >= ?1 - 86400000) AS active,
              SUM(twitch_user_id IS NOT NULL) AS twitch, SUM(created_at >= ?1 - 7 * 86400000) AS week
         FROM channels`,
    ).bind(now).first();
    const ses = await db(env).prepare("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?").bind(now).first();
    return [
      { label: "channels", value: s.n || 0, hint: `${s.week || 0} new this week` },
      { label: "active in 24 h", value: s.active || 0 },
      { label: "linked to twitch", value: s.twitch || 0 },
      { label: "open sessions", value: ses.n || 0 },
    ];
  },

  async panel(env, app, params) {
    const q = (params.get("q") || "").trim();
    const { results } = await db(env).prepare(
      `SELECT c.id, c.name, c.twitch_login, c.created_at, c.last_seen_at,
              (SELECT COUNT(*) FROM sessions s WHERE s.channel_id = c.id AND s.expires_at > ?1) AS sessions
         FROM channels c ${q ? "WHERE c.name LIKE ?2 OR c.twitch_login LIKE ?2 OR c.id = ?3" : ""}
         ORDER BY COALESCE(c.last_seen_at, c.created_at) DESC LIMIT 60`,
    ).bind(...(q ? [Date.now(), `%${q}%`, q] : [Date.now()])).all();
    return {
      filters: [{ name: "q", type: "search", placeholder: "channel or twitch login" }],
      tables: [{
        title: "channels",
        empty: "No channels yet.",
        columns: [
          { key: "name", label: "channel" },
          { key: "twitch_login", label: "twitch", type: "mono", none: "–" },
          { key: "sessions", label: "sessions", type: "num" },
          { key: "created_at", label: "created", type: "time_ms" },
          { key: "last_seen_at", label: "last active", type: "time_ms", none: "never" },
        ],
        rows: results,
        rowActions: [
          { action: "logout", label: "sign out", confirm: "End all sessions of this channel?" },
          { action: "delete-channel", label: "delete", confirm: "Delete this channel? Its overlay links stop working right away.", danger: true },
        ],
      }],
    };
  },

  actions: {
    async logout(env, app, form) {
      const id = String(form.get("id") || "");
      const r = await db(env).prepare("DELETE FROM sessions WHERE channel_id = ?").bind(id).run();
      return { target: id, message: `ended ${r.meta?.changes ?? 0} sessions` };
    },
    async "delete-channel"(env, app, form) {
      const id = String(form.get("id") || "");
      const ch = await db(env).prepare("SELECT id, name FROM channels WHERE id = ?").bind(id).first();
      if (!ch) throw new Error("channel no longer exists");
      await db(env).batch([
        db(env).prepare("DELETE FROM sessions WHERE channel_id = ?").bind(id),
        db(env).prepare("DELETE FROM channels WHERE id = ?").bind(id),
      ]);
      return { target: id, message: `deleted channel "${ch.name}"` };
    },
  },
};
