// Cloudflare Access JWT verification. field sits behind an Access application;
// this check is defence in depth so the Worker never trusts a request that skipped Access.
let jwks = { keys: null, at: 0 };

const b64url = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};
const decode = (part) => JSON.parse(new TextDecoder().decode(b64url(part)));

async function keys(team, force = false) {
  if (!force && jwks.keys && Date.now() - jwks.at < 3600_000) return jwks.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`access certs: ${res.status}`);
  jwks = { keys: (await res.json()).keys, at: Date.now() };
  return jwks.keys;
}

/** Returns { email } for a valid Access token, otherwise null. */
export async function verifyAccess(request, env) {
  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    (request.headers.get("Cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  let header, payload;
  try { header = decode(h); payload = decode(p); } catch { return null; }

  let list = await keys(env.ACCESS_TEAM_DOMAIN);
  let jwk = list.find((k) => k.kid === header.kid);
  if (!jwk) {
    list = await keys(env.ACCESS_TEAM_DOMAIN, true);
    jwk = list.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(env.ACCESS_AUD)) return null;
  return { email: payload.email || payload.common_name || "service-token" };
}
