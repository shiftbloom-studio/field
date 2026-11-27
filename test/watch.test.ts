// Account watchers with a fake Cloudflare API: AI usage over the limit, then Access changes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./fixture.ts";

let mf, env;
const alerts = [];
let neurons = 5_000_000;
let auditCalls = 0;

before(async () => {
  ({ mf, env } = await boot({
    bindings: { CF_API_TOKEN: "test-token", CF_ACCOUNT_ID: "acc", ALERT_WEBHOOK: "https://hooks.test/x" },
    outboundService: async (req) => {
      const u = new URL(req.url);
      if (u.host === "hooks.test") { alerts.push((await req.json()).content); return new Response("ok"); }
      if (u.pathname === "/client/v4/graphql") return Response.json({ data: { viewer: { accounts: [{ ai: [{ sum: { totalNeurons: neurons } }] }] } }, errors: null });
      if (u.pathname === "/client/v4/accounts/acc/logs/audit") {
        auditCalls++;
        assert.equal(u.searchParams.get("action_type.not"), "view");
        const result = auditCalls === 1 ? [] : [{ action: { description: "Update Access application", type: "update" }, actor: { email: "admin@example.org" }, resource: { product: "access" } }];
        return Response.json({ success: true, errors: [], result, result_info: {} });
      }
      return new Response("unexpected " + u, { status: 500 });
    },
  }));
});
after(() => mf?.dispose());

const tick = async (minute) => {
  const t = new Date(); t.setUTCMinutes(minute, 0, 0);
  await mf.getWorker().then((w) => w.scheduled({ cron: "*/5 * * * *", scheduledTime: t.getTime() }));
  await new Promise((r) => setTimeout(r, 300));
};

test("high AI usage opens an incident and alerts once", async () => {
  await tick(1);
  await tick(2);
  const open = (await env.DB.prepare("SELECT * FROM incidents WHERE app = 'ai-usage' AND resolved_at IS NULL").all()).results;
  assert.equal(open.length, 1);
  assert.equal(alerts.filter((a) => a.includes("Workers AI usage is high")).length, 1);
  neurons = 1000;
  await tick(3);
  assert.ok(alerts.some((a) => a.includes("back to normal")));
});

test("Access changes after the first run are reported", async () => {
  await tick(20);
  const inc = await env.DB.prepare("SELECT * FROM incidents WHERE app = 'access-changes'").first();
  assert.ok(inc, "access change recorded");
  assert.match(inc.error, /Update Access application by admin@example.org/);
  assert.ok(alerts.some((a) => a.startsWith("🔐 1 Access change")));
  const home = await (await mf.dispatchFetch("http://localhost/")).text();
  assert.match(home, /Access changes/);
});

test("privacy pages mention account monitoring when it is on", async () => {
  assert.match(await (await mf.dispatchFetch("http://localhost/privacy")).text(), /Account monitoring/);
  assert.match(await (await mf.dispatchFetch("http://localhost/datenschutz")).text(), /Kontoüberwachung/);
});

test("credit limits apply until AI_CREDIT_UNTIL, then the normal limits", async () => {
  const { aiLimits } = await import("../src/watch.ts");
  const vars = { AI_HOURLY_NEURONS: "200000", AI_DAILY_USD: "1", AI_CREDIT_UNTIL: "2026-12-01", AI_CREDIT_HOURLY_NEURONS: "10000000", AI_CREDIT_DAILY_USD: "60" };
  assert.deepEqual(aiLimits(vars, new Date("2026-11-30T23:59:00Z")), { hourly: 10_000_000, dailyUsd: 60, credit: true });
  assert.deepEqual(aiLimits(vars, new Date("2026-12-01T00:00:00Z")), { hourly: 200_000, dailyUsd: 1, credit: false });
  assert.deepEqual(aiLimits({ AI_CREDIT_UNTIL: "2999-01-01" }, new Date()), { hourly: 2_000_000, dailyUsd: 7, credit: true });
  assert.deepEqual(aiLimits({ AI_CREDIT_UNTIL: "not a date", AI_DAILY_USD: "3" }, new Date()), { hourly: 2_000_000, dailyUsd: 3, credit: false });
});
