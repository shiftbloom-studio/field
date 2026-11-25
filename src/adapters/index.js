import drop from "./drop.js";
import convert from "./convert.js";
import grow from "./grow.js";
import roots from "./roots.js";
import rhizome from "./rhizome.js";
import leaf from "./leaf.js";

const ADAPTERS = { drop, convert, grow, roots, rhizome, leaf };

/** The admin adapter for an app, or null if none is configured or its bindings are missing. */
export function adapterFor(env, app) {
  const a = app?.adapter && ADAPTERS[app.adapter];
  if (!a) return null;
  if (!a.binds.every((b) => env[b])) return null;
  return a;
}

/** The token provider of an app (create, list, revoke API tokens), or null. */
export function tokensFor(env, app) {
  const t = adapterFor(env, app)?.tokens;
  if (!t) return null;
  return t.binds.every((b) => env[b]) ? t : null;
}
