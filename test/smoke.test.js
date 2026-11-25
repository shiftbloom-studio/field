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
  assert.deepEqual(st.map((s) => [s.app, s.ok]), [["convert", 1], ["drop", 1], ["grow", 0], ["petal", 1], ["roots", 1]]);
  assert.equal(st.find((s) => s.app === "grow").fails, 2);
  const inc = await env.DB.prepare("SELECT * FROM incidents WHERE app = 'grow' AND resolved_at IS NULL").first();
  assert.ok(inc, "incident open");
});

test("pages render", async () => {
  const home = await (await get("/")).text();
  assert.match(home, /grow is down/);
  assert.match(home, /coming soon/);
  assert.ok(!home.includes("<b>channel</b>"));
  for (const id of ["drop", "convert", "grow", "roots", "petal", "runners"]) {
    const r = await get(`/apps/${id}`);
    const t = await r.text();
    assert.equal(r.status, 200, id);
    assert.ok(!t.includes("Could not load the admin view"), `${id}: ${t.match(/Could not load the admin view[^<]*/)?.[0]}`);
  }
  assert.match(await (await get("/apps/drop")).text(), /cat\.jpg/);
  assert.match(await (await get("/apps/grow")).text(), /My &lt;b&gt;channel/);
  const s = await (await get("/api/status")).json();
  assert.equal(s.apps.length, 6);
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
