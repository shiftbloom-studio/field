// Owner vs. member: everyone who passes Access may use the token managers, but a member
// only ever sees, mints and revokes rhizome keys for the rhizome person linked to their own email.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./fixture.ts";
import { isOwner } from "../src/auth.ts";

let mf, env;
before(async () => {
  // The local dev login (dev@localhost) acts as a member here.
  ({ mf, env } = await boot({ bindings: { DEV_AS_MEMBER: "true", OWNER_EMAILS: "owner@example.org" } }));
  const now = Date.now();
  await env.RHIZOME_DB.exec(`INSERT INTO users (id, name, created_at, email) VALUES ('u2', 'member', ${now}, 'Dev@Localhost')`);
  await env.RHIZOME_DB.exec(`INSERT INTO clients VALUES ('c2', 'u2', 'codex (openai)', 'codex', 'openai', '{}', ${now}, NULL)`);
  await env.RHIZOME_DB.exec(`INSERT INTO api_keys (hash, prefix, client_id, created_at, label) VALUES ('h-owner', 'rz_owner00', 'c1', ${now}, 'owner-key'), ('h-member', 'rz_member0', 'c2', ${now}, 'member-key')`);
});
after(() => mf?.dispose());

const get = (p) => mf.dispatchFetch(`http://localhost${p}`);
const post = (p, body = {}) =>
  mf.dispatchFetch(`http://localhost${p}`, { method: "POST", redirect: "manual", headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
const tokenSection = (html) => html.slice(html.indexOf('<section id="tokens">'));

test("isOwner matches OWNER_EMAILS case-insensitively and denies by default", () => {
  assert.equal(isOwner({ OWNER_EMAILS: "a@x.org, B@x.org" }, "b@X.org"), true);
  assert.equal(isOwner({ OWNER_EMAILS: "a@x.org b@x.org" }, "b@x.org"), true);
  assert.equal(isOwner({ OWNER_EMAILS: "a@x.org" }, "c@x.org"), false);
  assert.equal(isOwner({}, "a@x.org"), false);
  assert.equal(isOwner({ OWNER_EMAILS: "" }, ""), false);
});

test("member sees only their own rhizome keys and clients", async () => {
  const t = tokenSection(await (await get("/apps/rhizome")).text());
  assert.match(t, /member-key/);
  assert.doesNotMatch(t, /owner-key/);
  assert.match(t, /codex \(openai\)/);
  assert.doesNotMatch(t, /claude-code \(anthropic\) ·/, "owner's client is not offered");
  assert.doesNotMatch(t, /name="person"/, "no person picker for members");
});

test("member's agent client table lists only their own clients", async () => {
  const html = await (await get("/apps/rhizome")).text();
  const start = html.indexOf("<h3>agent clients</h3>");
  assert.ok(start > 0);
  const panel = html.slice(start, html.indexOf("</table>", start));
  assert.match(panel, /codex \(openai\)/);
  assert.doesNotMatch(panel, /claude-code \(anthropic\)/);
});

test("member cannot mint a key for the owner's client or person", async () => {
  let r = await post("/apps/rhizome/tokens", { label: "steal", expires: "30", client: "c1" });
  assert.match(r.headers.get("location"), /err=/);
  r = await post("/apps/rhizome/tokens", { label: "steal2", expires: "30", client: "new", agent: "x", provider: "local", person: "u1" });
  assert.match(r.headers.get("location"), /err=/);
  assert.equal((await env.RHIZOME_DB.prepare("SELECT COUNT(*) AS n FROM clients WHERE user_id = 'u1'").first()).n, 1);
  assert.equal(await env.RHIZOME_DB.prepare("SELECT 1 FROM api_keys WHERE label LIKE 'steal%'").first(), null);
});

test("member can mint keys for their own person", async () => {
  let r = await post("/apps/rhizome/tokens", { label: "mine", expires: "30", client: "c2" });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<code id="tok">rz_[0-9a-z]{32}<\/code>/);
  r = await post("/apps/rhizome/tokens", { label: "mine-new", expires: "30", client: "new", agent: "hermes", provider: "nous" });
  assert.equal(r.status, 200);
  const c = await env.RHIZOME_DB.prepare("SELECT user_id FROM clients WHERE agent = 'hermes'").first();
  assert.equal(c.user_id, "u2");
});

test("member cannot revoke the owner's keys, only their own", async () => {
  const id = async (label) => (await env.RHIZOME_DB.prepare("SELECT rowid AS id FROM api_keys WHERE label = ?").bind(label).first()).id;
  let r = await post("/apps/rhizome/tokens/revoke", { id: String(await id("owner-key")) });
  assert.match(decodeURIComponent(r.headers.get("location")).replace(/\+/g, " "), /already revoked/);
  assert.equal((await env.RHIZOME_DB.prepare("SELECT revoked_at FROM api_keys WHERE label = 'owner-key'").first()).revoked_at, null);
  r = await post("/apps/rhizome/tokens/revoke", { id: String(await id("member-key")) });
  assert.match(r.headers.get("location"), /ok=/);
  assert.ok((await env.RHIZOME_DB.prepare("SELECT revoked_at FROM api_keys WHERE label = 'member-key'").first()).revoked_at);
});

test("member without a linked rhizome person gets no keys", async () => {
  await env.RHIZOME_DB.exec("UPDATE users SET email = NULL WHERE id = 'u2'");
  const t = tokenSection(await (await get("/apps/rhizome")).text());
  assert.doesNotMatch(t, /mine-new|owner-key/);
  const r = await post("/apps/rhizome/tokens", { label: "x", expires: "30", client: "new", agent: "y", provider: "local" });
  assert.match(decodeURIComponent(r.headers.get("location")).replace(/\+/g, " "), /No rhizome memory is linked/);
  await env.RHIZOME_DB.exec("UPDATE users SET email = 'dev@localhost' WHERE id = 'u2'");
});

test("members keep the other token managers", async () => {
  const r = await post("/apps/drop/tokens", { label: "member-drop", expires: "30" });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<code id="tok">drop_/);
});

test("members cannot add rhizome people or see the people list", async () => {
  const page = await (await get("/apps/rhizome")).text();
  assert.doesNotMatch(page, /actions\/add-person/);
  assert.doesNotMatch(page, /owner@example\.org/);
  const r = await post("/apps/rhizome/actions/add-person", { id: "*", name: "Me Too", email: "other@example.org" });
  assert.equal(r.status, 403);
  assert.equal(await env.RHIZOME_DB.prepare("SELECT 1 FROM users WHERE email = 'other@example.org'").first(), null);
});

test("members only see their own clients in the rhizome admin table", async () => {
  const page = await (await get("/apps/rhizome")).text();
  assert.doesNotMatch(page, /claude-code \(anthropic\)/);
  assert.match(page, /codex \(openai\)/);
});
