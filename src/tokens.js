// API tokens for the apps. field issues them, the apps check them.
// Each adapter that supports tokens exports a `tokens` provider:
//   binds            bindings the provider needs
//   about            one sentence shown above the form
//   fields(env)      extra form fields, e.g. which client a key belongs to
//   list(env)        rows: { id, label, prefix, owner?, created_at, expires_at, last_used_at, revoked_at } (unix seconds)
//   create(env, t)   t = { label, expiresAt (unix seconds or null), form, user } → { secret, prefix, id, usage? }
//   revoke(env, id)  → number of tokens revoked
// The plain token exists only in the response that shows it once; apps store a SHA-256 hash.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function randomToken(prefix, length = 40, alphabet = ALPHABET) {
  // Rejection sampling keeps every character equally likely.
  const max = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < max && out.length < length) out += alphabet[b % alphabet.length];
    }
  }
  return prefix + out;
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const EXPIRY_CHOICES = [
  ["30", "30 days"],
  ["90", "90 days"],
  ["180", "180 days"],
  ["365", "1 year"],
  ["date", "on a date…"],
  ["never", "never"],
];

/**
 * Reads label and expiry from the form. Returns { label, expiresAt } with expiresAt in unix seconds
 * (null = never) or throws with a message meant for the person filling in the form.
 */
export function readTokenForm(form, now = Date.now()) {
  const label = String(form.get("label") || "").trim().replace(/\s+/g, " ");
  if (!label) throw new Error("Give the token a label, so you know later what it's for.");
  if (label.length > 80) throw new Error("Keep the label under 80 characters.");
  const choice = String(form.get("expires") || "90");
  let expiresAt;
  if (choice === "never") expiresAt = null;
  else if (choice === "date") {
    const d = String(form.get("expires_date") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("Pick the date the token should expire on.");
    expiresAt = Math.floor(Date.parse(`${d}T23:59:59Z`) / 1000);
    if (!Number.isFinite(expiresAt)) throw new Error("That date doesn't exist.");
  } else if (/^\d{1,4}$/.test(choice) && Number(choice) > 0) expiresAt = Math.floor(now / 1000) + Number(choice) * 86400;
  else throw new Error("Unknown expiry choice.");
  if (expiresAt !== null && expiresAt <= Math.floor(now / 1000)) throw new Error("The expiry date has to be in the future.");
  if (expiresAt !== null && expiresAt > Math.floor(now / 1000) + 5 * 366 * 86400) throw new Error("Pick an expiry within the next five years, or never.");
  return { label, expiresAt };
}

/** active | expired | revoked */
export function tokenState(row, now = Math.floor(Date.now() / 1000)) {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && row.expires_at <= now) return "expired";
  return "active";
}
