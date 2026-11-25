// Tenant config lives in wrangler.jsonc ("vars"), never in code.
// APPS: list of services field watches. LINKS: extra shortcuts on the overview.
import type { App, Env, Link } from "./types.ts";

/** An APPS entry as written in the config: everything but the id is optional. */
type AppEntry = Omit<App, "name"> & { name?: string };

const parse = <T,>(v: unknown, fallback: T): unknown => {
  if (v == null || v === "") return fallback;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return fallback; }
  }
  return v;
};

/** The services from APPS, with defaults filled in (the App type documents every field). */
export function apps(env: Env): App[] {
  const list = parse(env.APPS, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((a): a is AppEntry => a && typeof a.id === "string" && /^[a-z0-9-]{1,32}$/.test(a.id))
    .map((a) => ({ name: a.id, health: "/", ...a }));
}

export function app(env: Env, id: string): App | null {
  return apps(env).find((a) => a.id === id) || null;
}

export function links(env: Env): Link[] {
  const list = parse(env.LINKS, []);
  return Array.isArray(list) ? list.filter((l): l is Link => l && l.name && /^https:\/\//.test(l.url || "")) : [];
}

export const tz = (env: Env): string => env.TZ || "Europe/Berlin";
