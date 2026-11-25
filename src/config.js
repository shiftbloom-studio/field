// Tenant config lives in wrangler.jsonc ("vars"), never in code.
// APPS: list of services field watches. LINKS: extra shortcuts on the overview.

const parse = (v, fallback) => {
  if (v == null || v === "") return fallback;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return fallback; }
  }
  return v;
};

/**
 * @typedef {Object} App
 * @property {string} id          short slug, used in URLs and the database
 * @property {string} name        display name
 * @property {string} [url]       public URL (the "open" button)
 * @property {string} [blurb]     one line about what it does
 * @property {string} [service]   name of a service binding to the app's Worker (preferred for checks)
 * @property {string} [health]    path to probe, default "/"
 * @property {number[]} [expect]  HTTP statuses that count as healthy, default 200–399
 * @property {string} [adapter]   admin adapter: drop | convert | grow | roots | rhizome | leaf
 * @property {string} [db]        name of a D1 binding that is probed alongside the HTTP check
 * @property {string} [status]    "planned" shows a placeholder card without checks
 * @property {string} [repo]      source repository URL
 */

/** @returns {App[]} */
export function apps(env) {
  const list = parse(env.APPS, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a && typeof a.id === "string" && /^[a-z0-9-]{1,32}$/.test(a.id))
    .map((a) => ({ name: a.id, health: "/", ...a }));
}

export function app(env, id) {
  return apps(env).find((a) => a.id === id) || null;
}

/** @returns {{name:string,url:string,note?:string}[]} */
export function links(env) {
  const list = parse(env.LINKS, []);
  return Array.isArray(list) ? list.filter((l) => l && l.name && /^https:\/\//.test(l.url || "")) : [];
}

export const tz = (env) => env.TZ || "Europe/Berlin";
