import { test } from "node:test";
import assert from "node:assert/strict";
import { alert, parseFrom } from "../src/health.ts";

test("alerts go to email and webhook when both are configured", async (t) => {
  const mails = [];
  const hooks = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { hooks.push([url, JSON.parse(init.body)]); return new Response("ok"); });
  const env = {
    ALERT_MAIL: { send: async (m) => { mails.push(m); } },
    ALERT_EMAIL_FROM: "field <alerts@mail.test>",
    ALERT_EMAIL_TO: "ops@mail.test",
    ALERT_WEBHOOK: "https://hooks.test/x",
  };
  await alert(env, "🔴 drop is down: HTTP 502");
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].from, { name: "field", email: "alerts@mail.test" });
  assert.equal(mails[0].to, "ops@mail.test");
  assert.equal(mails[0].subject, "[field] 🔴 drop is down: HTTP 502");
  assert.match(mails[0].text, /drop is down/);
  assert.deepEqual(hooks, [["https://hooks.test/x", { content: "🔴 drop is down: HTTP 502", text: "🔴 drop is down: HTTP 502" }]]);
});

test("a failing channel doesn't break the others or throw", async (t) => {
  const hooks = [];
  t.mock.method(globalThis, "fetch", async (url) => { hooks.push(url); return new Response("ok"); });
  t.mock.method(console, "error", () => {});
  const env = { ALERT_MAIL: { send: async () => { throw new Error("not verified"); } }, ALERT_EMAIL_FROM: "a@b.test", ALERT_EMAIL_TO: "c@d.test", ALERT_WEBHOOK: "https://hooks.test/y" };
  await alert(env, "x");
  assert.equal(hooks.length, 1);
});

test("no channel: only a log line", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  await alert({}, "x");
  assert.equal(warn.mock.callCount(), 1);
});

test("sender parsing", () => {
  assert.deepEqual(parseFrom("field <alerts@x.test>"), { name: "field", email: "alerts@x.test" });
  assert.equal(parseFrom("alerts@x.test"), "alerts@x.test");
});
