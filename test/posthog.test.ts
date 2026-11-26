// PostHog in field: error reports and uptime metrics only, nothing about the person signed in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { uptimeProps } from "../src/health.ts";
import { phException, scrubText } from "../src/posthog.ts";
import { privacy } from "../src/legal.ts";

test("uptime metrics carry only app ids, up/down and latency", () => {
  const p = uptimeProps({ drop: { ok: true, ms: 41 }, grow: { ok: false, ms: 5000 }, "bad id!": { ok: true } });
  assert.deepEqual(p, { up_drop: true, ms_drop: 41, up_grow: false, ms_grow: 5000, apps: 3, apps_up: 2 });
});

test("error messages lose addresses, emails and ids", async () => {
  assert.equal(scrubText("token for owner@example.com at https://x.example/a failed"), "token for [email] at [url] failed");
  const real = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => (bodies.push(String(init?.body)), new Response("ok"))) as typeof fetch;
  try {
    await phException({ POSTHOG_KEY: "phc_testtoken1234567890" }, null, new Error("D1 failed for user a1b2c3d4e5"));
    await phException({}, null, new Error("off"));
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(bodies.length, 1);
  assert.ok(!bodies[0].includes("a1b2c3d4e5"));
});

test("the privacy policy names PostHog only when on", () => {
  assert.ok(!privacy({} as never, "en", "field.test").includes("Error reports and uptime metrics"));
  assert.ok(privacy({ POSTHOG_KEY: "phc_testtoken1234567890" } as never, "en", "field.test").includes("<h2>Error reports and uptime metrics</h2>"));
  assert.ok(privacy({ POSTHOG_KEY: "phc_testtoken1234567890" } as never, "de", "field.test").includes("<h2>Fehlerberichte und Verfügbarkeitsmetriken</h2>"));
});
