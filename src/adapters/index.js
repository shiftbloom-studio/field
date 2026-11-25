import drop from "./drop.js";
import convert from "./convert.js";
import grow from "./grow.js";
import roots from "./roots.js";

const ADAPTERS = { drop, convert, grow, roots };

/** The admin adapter for an app, or null if none is configured or its bindings are missing. */
export function adapterFor(env, app) {
  const a = app?.adapter && ADAPTERS[app.adapter];
  if (!a) return null;
  if (!a.binds.every((b) => env[b])) return null;
  return a;
}
