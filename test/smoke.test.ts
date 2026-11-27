// End-to-end smoke test: boots field in Miniflare with fake app Workers behind the
// service bindings, runs the cron, renders every page and fires each admin action once.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./fixture.ts";

let mf, env, deleted;
before(async () => ({ mf, env, deleted } = await boot()));
after(() => mf?.dispose());

const get = (p) => mf.dispatchFetch(`http://localhost${p}`);
const post = (p, body = {}) =>
  mf.dispatchFetch(`http://localhost${p}`, { method: "POST", redirect: "manual", headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });

test("cron records checks, opens an incident after two failures", async () => {
  await mf.getWorker().then((w) => w.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }));
  await new Promise((r) => setTimeout(r, 300));
  const r1 = await post("/check");
  assert.equal(r1.status, 303);
  const st = (await env.DB.prepare("SELECT app, ok, fails FROM state ORDER BY app").all()).results;
  assert.deepEqual(st.map((s) => [s.app, s.ok]), [["convert", 1], ["drop", 1], ["grow", 0], ["leaf", 1], ["petal", 1], ["rhizome", 1], ["roots", 1]]);
  assert.equal(st.find((s) => s.app === "grow").fails, 2);
  const inc = await env.DB.prepare("SELECT * FROM incidents WHERE app = 'grow' AND resolved_at IS NULL").first();
  assert.ok(inc, "incident open");
});

test("pages render", async () => {
  const home = await (await get("/")).text();
  assert.match(home, /grow is down/);
  assert.match(home, /coming soon/);
  assert.ok(!home.includes("<b>channel</b>"));
  for (const id of ["drop", "convert", "grow", "roots", "rhizome", "leaf", "petal", "runners"]) {
    const r = await get(`/apps/${id}`);
    const t = await r.text();
    assert.equal(r.status, 200, id);
    assert.ok(!t.includes("Could not load the admin view"), `${id}: ${t.match(/Could not load the admin view[^<]*/)?.[0]}`);
  }
  assert.match(await (await get("/apps/drop")).text(), /cat\.jpg/);
  assert.match(await (await get("/apps/grow")).text(), /My &lt;b&gt;channel/);
  const leafPage = await (await get("/apps/leaf")).text();
  assert.match(leafPage, /&lt;i&gt;notes/);
  assert.match(leafPage, /href="https:\/\/leaf\.test\/Paste0000001"/);
  assert.doesNotMatch(leafPage, /href="https:\/\/leaf\.test\/Burn00000001"/, "burn pastes are not linked");
  const s = await (await get("/api/status")).json();
  assert.equal(s.apps.length, 8);
  assert.equal((await get("/audit")).status, 200);
});

test("CSP: scripts only from self or with the response nonce, no inline handlers", async () => {
  const pages = ["/", "/apps/drop", "/apps/leaf", "/audit", "/privacy"];
  const seen = new Set();
  for (const p of pages) {
    const r = await get(p);
    const csp = r.headers.get("content-security-policy");
    const nonce = csp.match(/script-src 'self' 'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
    assert.ok(nonce, `${p}: ${csp}`);
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), `${p}: no unsafe-inline for scripts`);
    assert.ok(!seen.has(nonce), "fresh nonce per response");
    seen.add(nonce);
    const t = await r.text();
    const tags = t.match(/<script\b[^>]*>/gi) || [];
    for (const tag of tags) assert.ok(tag.includes(`nonce="${nonce}"`), `${p}: ${tag}`);
    assert.doesNotMatch(t, /\son[a-z]+\s*=/i, `${p}: inline event handler`);
  }
  assert.match(await (await get("/apps/drop")).text(), /data-confirm="/);
});

test("admin actions", async () => {
  let r = await post("/apps/drop/actions/delete", { id: "AbC12" });
  assert.match(r.headers.get("location"), /ok=/);
  assert.deepEqual(deleted, ["/d/AbC12/tok123"]);
  // token requests: listed with escaping, approved once, rejected, never decided twice
  const dropPage = await (await get("/apps/drop")).text();
  assert.match(dropPage, /token requests/);
  assert.match(dropPage, /Ada &lt;b&gt;L&lt;\/b&gt;/);
  r = await post("/apps/drop/actions/approve-request", { id: "req000000001" });
  assert.match(r.headers.get("location"), /ok=/);
  const ok = await env.DROP_DB.prepare("SELECT status, label, token_expires_at, decided_at FROM token_requests WHERE id = 'req000000001'").first();
  assert.equal(ok.status, "approved");
  assert.equal(ok.label, "request: Ada <b>L</b>");
  assert.ok(Math.abs(ok.token_expires_at - ok.decided_at - 90 * 86400) < 5);
  r = await post("/apps/drop/actions/approve-request-year", { id: "req000000001" });
  assert.match(r.headers.get("location"), /err=/);
  r = await post("/apps/drop/actions/reject-request", { id: "req000000002" });
  assert.match(r.headers.get("location"), /ok=/);
  assert.equal((await env.DROP_DB.prepare("SELECT status FROM token_requests WHERE id = 'req000000002'").first()).status, "rejected");
  r = await post("/apps/drop/actions/reject-request", { id: "../etc" });
  assert.match(r.headers.get("location"), /err=/);
  r = await post("/apps/convert/actions/delete-job", { id: "11111111-2222-3333-4444-555555555555" });
  assert.match(r.headers.get("location"), /ok=/);
  r = await post("/apps/convert/actions/reset-usage", { id: `${new Date().toISOString().slice(0, 10)}|ip:abc` });
  assert.match(r.headers.get("location"), /ok=/);
  r = await post("/apps/grow/actions/logout", { id: "ch1" });
  assert.equal(new URL(r.headers.get("location")).searchParams.get("ok"), "ended 1 sessions");
  r = await post("/apps/grow/actions/delete-channel", { id: "ch1" });
  assert.match(r.headers.get("location"), /ok=/);
  r = await post("/apps/roots/actions/sync", { id: "github/petal" });
  assert.match(r.headers.get("location"), /ok=/);
  r = await post("/apps/roots/actions/sync-all", { id: "*" });
  assert.match(r.headers.get("location"), /ok=/);
  r = await post("/apps/leaf/actions/delete", { id: "Paste0000001" });
  assert.match(r.headers.get("location"), /ok=/);
  assert.equal(await env.LEAF_DB.prepare("SELECT id FROM pastes WHERE id = 'Paste0000001'").first(), null);
  assert.equal(await env.LEAF_PASTES.get("p/Paste0000001"), null);
  assert.equal(await env.LEAF_PASTES.get("h/Paste0000001"), null);
  r = await post("/apps/leaf/actions/delete", { id: "../x" });
  assert.match(r.headers.get("location"), /err=/);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit").first();
  assert.equal(n.n, 13);
});

test("legal pages are public and bilingual", async () => {
  for (const [p, needle] of [["/privacy", "Privacy policy"], ["/datenschutz", "Datenschutzerklärung"], ["/imprint", "§ 5 DDG"], ["/impressum", "Angaben gemäß"]]) {
    const r = await mf.dispatchFetch(`http://example.com${p}`);
    assert.equal(r.status, 200, p);
    const t = await r.text();
    assert.ok(t.includes(needle), p);
    assert.ok(t.includes("Test Operator"), p);
  }
});

test("cross-origin posts and missing login are refused", async () => {
  const r = await mf.dispatchFetch("http://localhost/check", { method: "POST", headers: { origin: "https://evil.test" } });
  assert.equal(r.status, 403);
  const r2 = await mf.dispatchFetch("http://example.com/");
  assert.equal(r2.status, 401);
});

test("API tokens: create shows the secret once, stores a hash, revoke works", async () => {
  const { sha256Hex } = await import("../src/tokens.ts");
  // drop
  let r = await post("/apps/drop/tokens", { label: "laptop", expires: "30" });
  assert.equal(r.status, 200);
  let page = await r.text();
  const secret = page.match(/<code id="tok">(drop_[A-Za-z0-9]{40})<\/code>/)?.[1];
  assert.ok(secret, "secret shown");
  assert.equal(r.headers.get("cache-control"), "no-store");
  let row = await env.DROP_DB.prepare("SELECT * FROM api_tokens WHERE label = 'laptop'").first();
  assert.equal(row.hash, await sha256Hex(secret));
  assert.equal(row.prefix, secret.slice(0, 12));
  assert.ok(row.expires_at > Date.now() / 1000 + 29 * 86400 && row.expires_at < Date.now() / 1000 + 31 * 86400);
  assert.equal(row.created_by, "dev@localhost");
  const list = await (await get("/apps/drop")).text();
  assert.match(list, /laptop/);
  assert.ok(!list.includes(secret), "secret never shown again");
  const audit = await env.DB.prepare("SELECT * FROM audit WHERE action = 'create-token'").all();
  assert.ok(audit.results.length && audit.results.every((a) => !JSON.stringify(a).includes(secret)), "secret not in audit");
  r = await post("/apps/drop/tokens/revoke", { id: row.id });
  assert.match(r.headers.get("location"), /ok=/);
  row = await env.DROP_DB.prepare("SELECT revoked_at FROM api_tokens WHERE label = 'laptop'").first();
  assert.ok(row.revoked_at);

  // validation
  r = await post("/apps/drop/tokens", { label: "", expires: "30" });
  assert.match(decodeURIComponent(r.headers.get("location")), /label/);
  r = await post("/apps/drop/tokens", { label: "old", expires: "date", expires_date: "2001-01-01" });
  assert.match(decodeURIComponent(r.headers.get("location")).replace(/\+/g, " "), /future/);
  r = await post("/apps/drop/tokens", { label: "forever", expires: "never" });
  assert.equal(r.status, 200);
  assert.equal((await env.DROP_DB.prepare("SELECT expires_at FROM api_tokens WHERE label = 'forever'").first()).expires_at, null);
  r = await post("/apps/convert/tokens", { label: "x", expires: "30" });
  assert.equal(r.status, 404);

  // leaf: same schema as drop, leaf_ prefix
  r = await post("/apps/leaf/tokens", { label: "editor", expires: "90" });
  assert.equal(r.status, 200);
  const leafSecret = (await r.text()).match(/<code id="tok">(leaf_[A-Za-z0-9]{40})<\/code>/)?.[1];
  assert.ok(leafSecret, "leaf secret shown");
  const lrow = await env.LEAF_DB.prepare("SELECT * FROM api_tokens WHERE label = 'editor'").first();
  assert.equal(lrow.hash, await sha256Hex(leafSecret));
  assert.equal(lrow.prefix, leafSecret.slice(0, 12));
  r = await post("/apps/leaf/tokens/revoke", { id: lrow.id });
  assert.match(r.headers.get("location"), /ok=/);
  assert.ok((await env.LEAF_DB.prepare("SELECT revoked_at FROM api_tokens WHERE id = ?").bind(lrow.id).first()).revoked_at);

  // rhizome: keys in rhizome's own format, times in ms
  const day = new Date(Date.now() + 400 * 86400e3).toISOString().slice(0, 10);
  r = await post("/apps/rhizome/tokens", { label: "ci", expires: "date", expires_date: day, client: "c1" });
  page = await r.text();
  const key = page.match(/<code id="tok">(rz_[0-9a-z]{32})<\/code>/)?.[1];
  assert.ok(key, "rhizome key shown");
  const k = await env.RHIZOME_DB.prepare("SELECT rowid AS id, * FROM api_keys WHERE label = 'ci'").first();
  assert.equal(k.hash, await sha256Hex(key));
  assert.equal(k.prefix, key.slice(0, 10));
  assert.equal(k.client_id, "c1");
  assert.equal(k.expires_at, Date.parse(`${day}T23:59:59Z`));
  assert.match(await (await get("/apps/rhizome")).text(), /claude-code \(anthropic\)/);
  // new agent: creates the client with rhizome's default grants, then its key; a second key reuses it
  r = await post("/apps/rhizome/tokens", { label: "desk", expires: "90", client: "new", agent: "hermes", provider: "nous" });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /for hermes \(nous\)/);
  const hc = await env.RHIZOME_DB.prepare("SELECT * FROM clients WHERE agent = 'hermes'").first();
  assert.equal(hc.user_id, "u1");
  assert.deepEqual(JSON.parse(hc.grants).read, ["profile", "project:*", "agent:self"]);
  assert.match(hc.id, /^[0-9a-z]{21}$/);
  await post("/apps/rhizome/tokens", { label: "laptop", expires: "90", client: "new", agent: "hermes", provider: "nous" });
  assert.equal((await env.RHIZOME_DB.prepare("SELECT COUNT(*) AS n FROM clients WHERE agent = 'hermes'").first()).n, 1);
  assert.equal((await env.RHIZOME_DB.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE client_id = ?").bind(hc.id).first()).n, 2);
  r = await post("/apps/rhizome/tokens", { label: "x", expires: "30", client: "new", agent: "Bad Agent!", provider: "nous" });
  assert.match(r.headers.get("location"), /err=/);
  r = await post("/apps/rhizome/tokens", { label: "x", expires: "30", client: "nope" });
  assert.match(r.headers.get("location"), /err=/);
  r = await post("/apps/rhizome/tokens/revoke", { id: String(k.id) });
  assert.match(r.headers.get("location"), /ok=/);
  assert.ok((await env.RHIZOME_DB.prepare("SELECT revoked_at FROM api_keys WHERE label = 'ci'").first()).revoked_at);
});

test("token forms from other origins are refused", async () => {
  const r = await mf.dispatchFetch("http://localhost/apps/drop/tokens", { method: "POST", redirect: "manual", headers: { origin: "https://evil.test", "content-type": "application/x-www-form-urlencoded" }, body: "label=x&expires=30" });
  assert.equal(r.status, 403);
});

test("form posts with Origin: null are judged by Sec-Fetch-Site, never a 500", async () => {
  const send = (headers) => mf.dispatchFetch("http://localhost/check", { method: "POST", redirect: "manual", headers });
  assert.equal((await send({ origin: "null", "sec-fetch-site": "same-origin" })).status, 303);
  assert.equal((await send({ origin: "null" })).status, 403);
  assert.equal((await send({ origin: "not a url" })).status, 403);
});

test("overview cards show the app URL and link to its API tokens", async () => {
  const home = await (await get("/")).text();
  assert.match(home, /class="url mono" href="https:\/\/drop\.test"/);
  assert.match(home, /href="\/apps\/drop#tokens">API tokens</);
  assert.doesNotMatch(home, /href="\/apps\/convert#tokens"/);
  assert.match(await (await get("/apps/drop")).text(), /<section id="tokens">/);
});

test("owners add rhizome people with a linked email", async () => {
  let r = await post("/apps/rhizome/actions/add-person", { id: "*", name: "  New  Member ", email: " New@Example.org " });
  assert.match(r.headers.get("location"), /ok=/);
  const u = await env.RHIZOME_DB.prepare("SELECT * FROM users WHERE email = 'new@example.org'").first();
  assert.equal(u.name, "New Member");
  assert.match(u.id, /^[0-9a-z]{21}$/);
  r = await post("/apps/rhizome/actions/add-person", { id: "*", name: "Again", email: "new@example.org" });
  assert.match(decodeURIComponent(r.headers.get("location")).replace(/\+/g, " "), /already linked to New Member/);
  r = await post("/apps/rhizome/actions/add-person", { id: "*", name: "Bad", email: "not-an-email" });
  assert.match(r.headers.get("location"), /err=/);
  r = await post("/apps/rhizome/actions/add-person", { id: "*", name: "", email: "x@example.org" });
  assert.match(r.headers.get("location"), /err=/);
  assert.equal((await env.RHIZOME_DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n, 2);
  const page = await (await get("/apps/rhizome")).text();
  assert.match(page, /action="\/apps\/rhizome\/actions\/add-person"/);
  assert.match(page, /new@example\.org/);
  const audit = await env.DB.prepare("SELECT * FROM audit WHERE action = 'add-person' ORDER BY id LIMIT 1").first();
  assert.match(audit.target, /^New Member \(/);
});
