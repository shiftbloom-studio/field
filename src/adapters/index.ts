import drop from "./drop.ts";
import convert from "./convert.ts";
import grow from "./grow.ts";
import roots from "./roots.ts";
import rhizome from "./rhizome.ts";
import leaf from "./leaf.ts";

import type { Adapter, App, Env, TokenProvider } from "../types.ts";

const ADAPTERS: Record<string, Adapter> = { drop, convert, grow, roots, rhizome, leaf };

/** The admin adapter for an app, or null if none is configured or its bindings are missing. */
export function adapterFor(env: Env, app: App | null | undefined): Adapter | null {
  const a = app?.adapter && ADAPTERS[app.adapter];
  if (!a) return null;
  if (!a.binds.every((b) => env[b])) return null;
  return a;
}

/** The token provider of an app (create, list, revoke API tokens), or null. */
export function tokensFor(env: Env, app: App | null | undefined): TokenProvider | null {
  const t = adapterFor(env, app)?.tokens;
  if (!t) return null;
  return t.binds.every((b) => env[b]) ? t : null;
}
