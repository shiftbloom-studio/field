// End-to-end smoke test: boots field in Miniflare with fake app Workers behind the
// service bindings, runs the cron, renders every page and fires each admin action once.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./fixture.js";

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
  assert.deepEqual(st.map((s) => [s.app, s.ok]), [["convert", 1], ["drop", 1], ["grow", 0], ["petal", 1], ["rhizome", 1], ["roots", 1]]);
  assert.equal(st.find((s) => s.app === "grow").fails, 2);
  const inc = await env.DB.prepare("SELECT * FROM incidents WHERE app = 'grow' AND resolved_at IS NULL").first();
  assert.ok(inc, "incident open");
});

test("pages render", async () => {
  const home = await (await get("/")).text();
  assert.match(home, /grow is down/);
  assert.match(home, /coming soon/);
  assert.ok(!home.includes("<b>channel</b>"));
  for (const id of ["drop", "convert", "grow", "roots", "rhizome", "petal", "runners"]) {
    const r = await get(`/apps/${id}`);
    const t = await r.text();
    assert.equal(r.status, 200, id);
    assert.ok(!t.includes("Could not load the admin view"), `${id}: ${t.match(/Could not load the admin view[^<]*/)?.[0]}`);
  }
  assert.match(await (await get("/apps/drop")).text(), /cat\.jpg/);
  assert.match(await (await get("/apps/grow")).text(), /My &lt;b&gt;channel/);
  const s = await (await get("/api/status")).json();
  assert.equal(s.apps.length, 7);
  assert.equal((await get("/audit")).status, 200);
});

test("admin actions", async () => {
  let r = await post("/apps/drop/actions/delete", { id: "AbC12" });
  assert.match(r.headers.get("location"), /ok=/);
  assert.deepEqual(deleted, ["/d/AbC12/tok123"]);
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
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit").first();
  assert.equal(n.n, 7);
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
  const { sha256Hex } = await import("../src/tokens.js");
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
  assert.match(home, /href="\/apps\/drop#tokens">api tokens</);
  assert.doesNotMatch(home, /href="\/apps\/convert#tokens"/);
  assert.match(await (await get("/apps/drop")).text(), /<section id="tokens">/);
});
