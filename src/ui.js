import { WATCHERS } from "./watch.js";
import { bloom, css, esc, SPARK } from "./brand.js";

// ---------- formatting ----------
export const fmtSize = (n) => {
  if (n == null) return "–";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  n = Number(n);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString("en-GB", { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
};
const fmtNum = (n) => (n == null ? "–" : Number(n).toLocaleString("en-GB"));
const pct = (r) => (r == null ? "–" : `${(r * 100).toLocaleString("en-GB", { maximumFractionDigits: r >= 0.9995 ? 0 : 2 })} %`);

export function rel(ts) {
  if (!ts) return "–";
  const d = Math.round(Date.now() / 1000 - ts);
  const fut = d < 0;
  const a = Math.abs(d);
  let s;
  if (a < 45) return fut ? "in a moment" : "just now";
  if (a < 3600) s = `${Math.round(a / 60)} min`;
  else if (a < 86400) s = `${Math.round(a / 3600)} h`;
  else s = `${Math.round(a / 86400)} ${Math.round(a / 86400) === 1 ? "day" : "days"}`;
  return fut ? `in ${s}` : `${s} ago`;
}
const abs = (ts, tz) => (ts ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(ts * 1000)) : "");
const timeEl = (ts, tz, none = "–") => (ts ? `<time title="${esc(abs(ts, tz))}">${esc(rel(ts))}</time>` : `<span class="muted">${esc(none)}</span>`);
const dur = (s) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `${(s / 3600).toLocaleString("en-GB", { maximumFractionDigits: 1 })} h` : `${Math.round(s / 86400)} days`);

/** up | warn | down | idle */
export function health(st, app) {
  if (app?.status === "planned") return { cls: "idle", text: "planned" };
  if (!st) return { cls: "idle", text: "not checked yet" };
  if (st.ok) return { cls: "up", text: "up" };
  if (st.fails >= 2) return { cls: "down", text: "down" };
  return { cls: "warn", text: "flaky" };
}

const strip = (buckets, tz) =>
  `<div class="strip" aria-hidden="true">${buckets
    .map((b) => {
      const cls = b.up == null ? "none" : b.up >= 0.999 ? "" : b.up >= 0.5 ? "mid" : "bad";
      const title = b.up == null ? "no data" : `${pct(b.up)} · ${abs(b.from, tz)}`;
      return `<i class="${cls}" title="${esc(title)}"></i>`;
    })
    .join("")}</div>`;

// ---------- layout ----------
export function layout(env, { title, user, active = "", body, extraCss = "", lang = "en" }) {
  const source = env.SOURCE_URL || "https://github.com/shiftbloom-studio/field";
  return `<!doctype html><html lang="${lang === "de" ? "de" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · field</title><meta name="robots" content="noindex"><meta name="theme-color" content="#ffffff">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/fonts.css">
<style>${css}${extraCss}</style></head><body><div class="wrap">
<header class="top"><a class="brand" href="/" aria-label="field, shiftbloom studio">${bloom({ size: 28, solid: true })}<span class="word">field<i>.</i></span><span class="by">shiftbloom studio</span></a>
<nav><a href="/" class="${active === "home" ? "on" : ""}">overview</a><a href="/audit" class="${active === "audit" ? "on" : ""}">audit log</a>${user ? `<span class="who">${esc(user.email)}</span>` : ""}</nav></header>
${body}
<footer class="foot"><span class="label">field · intranet of ${esc(env.ORG_NAME || "shiftbloom studio")}</span><span class="label legal"><a href="/privacy">privacy</a> · <a href="/datenschutz">datenschutz</a> · <a href="/imprint">imprint</a> · <a href="/impressum">impressum</a> · <a href="${esc(source)}">source</a> · agpl-3.0</span></footer>
</div></body></html>`;
}

const flash = (params) => {
  const ok = params.get("ok"), err = params.get("err");
  if (ok) return `<div class="flash ok unfold"><span class="seed up"></span>${esc(ok)}</div>`;
  if (err) return `<div class="flash err unfold"><span class="seed down"></span>${esc(err)}</div>`;
  return "";
};

// ---------- overview ----------
const homeCss = `
.hero{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;padding:clamp(34px,6vw,72px) 0 clamp(24px,4vw,40px);position:relative}
.hero p{color:var(--ink60);font-size:17px;margin:14px 0 0;max-width:36em}
.hero .flower .bloom{width:clamp(110px,16vw,180px);height:auto;animation:unfold .6s var(--ease) both,breathe 6s ease-in-out .6s infinite}
.hero .flower .ring{transform-origin:0 0}.hero .flower .r0{animation:spin 240s linear infinite}
@keyframes breathe{50%{transform:scale(1.02)}}@keyframes spin{to{transform:rotate(360deg)}}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.card{background:var(--warm);border-radius:20px;padding:20px 22px;display:flex;flex-direction:column;gap:14px;transition:transform .24s var(--ease)}
.card:hover{transform:translateY(-2px)}
.card.planned{background:#fff;box-shadow:inset 0 0 0 1.5px var(--line);border:0}
.card.down{box-shadow:inset 0 0 0 1.5px var(--bloom)}
.card header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.card h3 a{color:var(--ink);background:none}.card h3 a:hover{color:var(--root)}
.card .blurb{color:var(--ink60);font-size:14px;margin-top:4px}
.card .meta{display:grid;grid-template-columns:repeat(4,minmax(0,auto));justify-content:start;gap:16px 22px}
.card .meta div{display:flex;flex-direction:column;gap:2px}
.card .meta b{font:500 14px/1.2 var(--mono)}
.card .err{font:12px/1.5 var(--mono);color:var(--root);background:var(--blush);border-radius:10px;padding:8px 10px}
.card footer{display:flex;gap:8px;margin-top:auto}
.status{display:flex;align-items:center;gap:8px;font:500 11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink60);white-space:nowrap}
section{margin-top:56px}section>header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:16px}
.list{list-style:none;margin:0;padding:0}.list li{display:flex;gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.links{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.links a{display:block;background:#fff;box-shadow:inset 0 0 0 1px var(--line);border-radius:16px;padding:14px 16px;color:var(--ink);transition:box-shadow .24s var(--settle)}
.links a:hover{box-shadow:inset 0 0 0 1px var(--ink);background-size:0}
.links a small{display:block;color:var(--ink60);font-size:13px}
.sprinkle{position:absolute;pointer-events:none}
@media(max-width:640px){.hero{grid-template-columns:1fr}.hero .flower{display:none}}
@media(max-width:480px){.card .meta{grid-template-columns:repeat(2,auto)}.grid{grid-template-columns:1fr}}
`;

function headline(list, states) {
  const live = list.filter((a) => a.status !== "planned");
  const down = live.filter((a) => health(states[a.id], a).cls === "down");
  const warn = live.filter((a) => health(states[a.id], a).cls === "warn");
  const unchecked = live.filter((a) => !states[a.id]);
  if (!live.length) return ["Nothing here yet<em>.</em>", "Add your services to APPS and they show up here."];
  if (unchecked.length === live.length) return ["Almost there<em>.</em>", "The first check runs on the next cron tick. Or start it yourself below."];
  if (down.length) return [`${esc(down.map((a) => a.name).join(", "))} ${down.length === 1 ? "is" : "are"} down<em>.</em>`, `${live.length - down.length} of ${live.length} services are running normally.`];
  if (warn.length) return [`${esc(warn[0].name)} is wobbling<em>.</em>`, "One check failed. If the next one fails too, it becomes an incident."];
  return ["All good<em>.</em>", `${live.length} services, all reachable. Checked every five minutes.`];
}

export function overviewPage(env, { user, list, states, up24, strips, stats, incidents, open, links, params, tz }) {
  const [h1, sub] = headline(list, states);
  const last = Math.max(0, ...Object.values(states).map((s) => s.last_ts || 0));

  const cards = list
    .map((a, i) => {
      if (a.status === "planned")
        return `<article class="card planned unfold" style="animation-delay:${i * 40}ms"><header><div><h3>${esc(a.name)}</h3><div class="blurb">${esc(a.blurb || "")}</div></div><span class="tag plain">coming soon</span></header>
<p class="muted" style="margin:0;font-size:14px">${esc(a.note || "Shows up here with health checks once it's live.")}</p></article>`;
      const st = states[a.id];
      const h = health(st, a);
      const tiles = (stats[a.id] || []).slice(0, 2);
      return `<article class="card ${h.cls === "down" ? "down" : ""} unfold" style="animation-delay:${i * 40}ms">
<header><div><h3><a href="/apps/${esc(a.id)}">${esc(a.name)}</a></h3><div class="blurb">${esc(a.blurb || "")}</div></div><span class="status"><span class="seed ${h.cls}"></span>${h.text}</span></header>
${strip(strips[a.id] || Array.from({ length: 48 }, () => ({ up: null })), tz)}
<div class="meta"><div><span class="label">24 h</span><b>${pct(up24[a.id])}</b></div><div><span class="label">response</span><b>${st?.ms != null ? `${st.ms} ms` : "–"}</b></div>${tiles
        .map((t) => `<div><span class="label">${esc(t.label)}</span><b>${t.type === "size" ? fmtSize(t.value) : t.type === "time" ? esc(rel(t.value)) : fmtNum(t.value)}</b></div>`)
        .join("")}</div>
${st && !st.ok && st.error ? `<div class="err">${esc(st.error)}</div>` : ""}
<footer><a class="btn sm" href="/apps/${esc(a.id)}">${a.adapter ? "manage" : "details"}</a>${a.url ? `<a class="btn sm ghost" href="${esc(a.url)}" target="_blank" rel="noopener">open ↗</a>` : ""}</footer>
</article>`;
    })
    .join("");

  const inc = incidents.length
    ? `<ul class="list">${incidents
        .map((x) => {
          const a = list.find((l) => l.id === x.app);
          const watcher = !a && WATCHERS[x.app];
          const name = watcher ? `<b>${esc(watcher)}</b>` : `<a href="/apps/${esc(x.app)}"><b>${esc(a?.name || x.app)}</b></a>`;
          const when = watcher
            ? x.resolved_at && x.resolved_at === x.started_at
              ? timeEl(x.started_at, tz)
              : x.resolved_at
                ? `for ${dur(x.resolved_at - x.started_at)}, ${timeEl(x.started_at, tz)}`
                : `for ${dur(Date.now() / 1000 - x.started_at)} and counting`
            : x.resolved_at
              ? `down for ${dur(x.resolved_at - x.started_at)}, ${timeEl(x.started_at, tz)}`
              : `down for ${dur(Date.now() / 1000 - x.started_at)} and counting`;
          return `<li><span class="seed ${x.resolved_at ? "up" : "down"}"></span>${name}<span class="muted">${when}</span><span class="mono muted" style="margin-left:auto">${esc(x.error || "")}</span></li>`;
        })
        .join("")}</ul>`
    : `<p class="muted">No incidents in the last seven days.</p>`;

  const linkHtml = links.length
    ? `<section><header><h2>Shortcuts</h2></header><div class="links">${links
        .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener"><b>${esc(l.name)}</b><small>${esc(l.note || new URL(l.url).host)}</small></a>`)
        .join("")}</div></section>`
    : "";

  const body = `${flash(params)}
<div class="hero"><div><span class="label">${open ? `${open} open incident${open === 1 ? "" : "s"}` : "status"}</span><h1 style="margin-top:12px">${h1}</h1><p>${sub}${last ? ` Last check ${esc(rel(last))}.` : ""}</p>
<form method="post" action="/check" style="margin-top:20px"><button class="btn ghost sm">check all now</button></form></div>
<div class="flower">${bloom({ size: 180, anim: true, id: "hero" })}</div>
<span class="sprinkle" style="right:2%;top:16%">${SPARK(14)}</span></div>
<div class="grid">${cards}</div>
<section><header><h2>Incidents</h2><span class="label">last 7 days</span></header>${inc}</section>
${linkHtml}`;
  return layout(env, { title: "overview", user, active: "home", body, extraCss: homeCss });
}

// ---------- app detail ----------
const appCss = `
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;padding:clamp(28px,5vw,56px) 0 24px}
.head p{color:var(--ink60);margin:10px 0 0}
.status{display:flex;align-items:center;gap:8px;font:500 11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink60)}
section{margin-top:44px}section>header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.strip.big{height:48px}
.axis{display:flex;justify-content:space-between;margin-top:6px}
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.filters label{display:flex;gap:6px;align-items:center;font-size:14px;color:var(--ink60)}
.errbox{font:12px/1.5 var(--mono);color:var(--root);background:var(--blush);border-radius:12px;padding:12px 14px;margin-top:14px;white-space:pre-wrap;word-break:break-word}
pre.detail{font:12px/1.5 var(--mono);background:var(--ink);color:#fff;border-radius:12px;padding:12px 14px;overflow:auto;margin:14px 0 0}
`;

function cell(col, row, tz) {
  const v = col.render ? col.render(row) : row[col.key];
  switch (col.type) {
    case "link": return `<a class="mono" href="${esc(col.href(row))}" target="_blank" rel="noopener">${esc(v)}</a>`;
    case "tag": return v ? `<span class="tag">${esc(v)}</span>` : "";
    case "mono": return v == null || v === "" ? `<span class="muted">${esc(col.none || "")}</span>` : `<span class="mono">${esc(v)}</span>`;
    case "size": return fmtSize(v);
    case "num": return fmtNum(v);
    case "time": return timeEl(v, tz, col.none);
    case "time_ms": return timeEl(v ? Math.floor(v / 1000) : null, tz, col.none);
    case "iso": return timeEl(v ? Math.floor(Date.parse(v) / 1000) : null, tz, col.none);
    case "flag": return v ? `<span class="tag">${esc(col.text)}</span>` : "";
    case "status": {
      const s = String(v || "");
      const bad = /fail|error/i.test(s), busy = /syncing|running|uploading|queued|processing|converting|pending/i.test(s);
      return `<span class="status"><span class="seed ${bad ? "down" : busy ? "warn" : "up"}"></span>${esc(s)}</span>`;
    }
    case "muted": return v ? `<span class="muted clip mono" title="${esc(v)}" style="font-size:12px">${esc(v)}</span>` : "";
    default: return v == null || v === "" ? `<span class="muted">${esc(col.none || "")}</span>` : `<span class="clip" title="${esc(v)}">${esc(v)}</span>`;
  }
}

const actionForm = (appId, a, id, cls = "") =>
  `<form method="post" action="/apps/${esc(appId)}/actions/${esc(a.action)}"${a.confirm ? ` onsubmit="return confirm(${esc(JSON.stringify(a.confirm))})"` : ""}><input type="hidden" name="id" value="${esc(id)}"><button class="btn sm ${a.danger ? "danger" : "ghost"} ${cls}">${esc(a.label)}</button></form>`;

function renderTable(app, t, tz) {
  const key = t.key || ((r) => r.id);
  const acts = t.rowActions || [];
  const head = t.columns.map((c) => `<th class="${["num", "size"].includes(c.type) ? "num" : ""}">${esc(c.label)}</th>`).join("") + (acts.length ? "<th></th>" : "");
  const rows = t.rows.length
    ? t.rows
        .map(
          (r) =>
            `<tr>${t.columns.map((c) => `<td class="${["num", "size"].includes(c.type) ? "num" : ""}">${cell(c, r, tz)}</td>`).join("")}${
              acts.length ? `<td class="act">${acts.filter((a) => !a.when || a.when(r)).map((a) => actionForm(app.id, a, key(r))).join(" ")}</td>` : ""
            }</tr>`,
        )
        .join("")
    : `<tr><td colspan="${t.columns.length + (acts.length ? 1 : 0)}" class="muted" style="padding:22px 10px">${esc(t.empty || "Nothing here.")}</td></tr>`;
  return `<section><header><h3>${esc(t.title)}</h3>${t.note ? `<span class="muted" style="font-size:13px;max-width:52ch">${esc(t.note)}</span>` : `<span class="label">${t.rows.length} rows</span>`}</header><div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function renderFilters(filters, params) {
  if (!filters?.length) return "";
  const f = filters
    .map((x) => {
      const v = params.get(x.name) || "";
      if (x.type === "search") return `<input type="search" name="${esc(x.name)}" value="${esc(v)}" placeholder="${esc(x.placeholder || "search")}" style="min-width:240px">`;
      if (x.type === "select") return `<select name="${esc(x.name)}">${x.options.map(([val, label]) => `<option value="${esc(val)}"${val === v ? " selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
      if (x.type === "check") return `<label><input type="checkbox" name="${esc(x.name)}" value="1"${v === "1" ? " checked" : ""}> ${esc(x.label)}</label>`;
      return "";
    })
    .join("");
  return `<form class="filters" method="get">${f}<button class="btn sm ghost">filter</button></form>`;
}

export function appPage(env, { user, app, state, up, strip7d, checks, incidents, tiles, panel, panelError, params, tz }) {
  const h = health(state, app);
  const detail = state?.detail ? (() => { try { return JSON.stringify(JSON.parse(state.detail), null, 2); } catch { return state.detail; } })() : "";
  const body = `${flash(params)}
<div class="head"><div><span class="label"><a href="/" style="color:inherit">overview</a> / ${esc(app.id)}</span><h1 style="margin-top:10px">${esc(app.name)}<em>.</em></h1><p>${esc(app.blurb || "")}</p></div>
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="status"><span class="seed ${h.cls}"></span>${h.text}${state?.since ? ` · for ${esc(dur(Date.now() / 1000 - state.since))}` : ""}</span>
${app.status !== "planned" ? `<form method="post" action="/apps/${esc(app.id)}/check"><button class="btn sm ghost">check now</button></form>` : ""}
${app.url ? `<a class="btn sm" href="${esc(app.url)}" target="_blank" rel="noopener">open ↗</a>` : ""}</div></div>

${app.status === "planned" ? `<div class="panel"><p style="margin:0">${esc(app.note || "This service is still being planned. Once it runs, give it a URL or a service binding in APPS and field starts checking it.")}</p></div>` : `
<div class="tiles">
<div class="tile"><span class="label">24 h</span><b>${pct(up.d1[app.id])}</b></div>
<div class="tile"><span class="label">7 days</span><b>${pct(up.d7[app.id])}</b></div>
<div class="tile"><span class="label">30 days</span><b>${pct(up.d30[app.id])}</b></div>
<div class="tile"><span class="label">response time</span><b>${state?.ms != null ? `${state.ms} ms` : "–"}</b><small>${state?.status ? `HTTP ${state.status}` : ""}${app.service ? " · service binding" : ""}${app.db ? " · d1" : ""}</small></div>
</div>
<section><header><h3>Availability</h3><span class="label">7 days · 2 h per bar</span></header>${strip(strip7d, tz).replace('class="strip"', 'class="strip big"')}<div class="axis"><span class="label">7 days ago</span><span class="label">now</span></div>
${state && !state.ok && state.error ? `<div class="errbox">${esc(state.error)}</div>` : ""}${detail ? `<pre class="detail">${esc(detail)}</pre>` : ""}</section>`}

${tiles?.length ? `<section><header><h2>Numbers</h2></header><div class="tiles">${tiles
    .map((t) => `<div class="tile${t.warn ? " warn" : ""}"><span class="label">${esc(t.label)}</span><b>${t.type === "size" ? fmtSize(t.value) : t.type === "time" ? esc(rel(t.value)) : fmtNum(t.value)}</b>${t.hint ? `<small>${esc(t.hint)}</small>` : ""}</div>`)
    .join("")}</div></section>` : ""}

${panelError ? `<section><div class="errbox">Could not load the admin view: ${esc(panelError)}</div></section>` : ""}
${panel ? `<section><header><h2>Manage</h2><div class="filters">${(panel.actions || []).map((a) => actionForm(app.id, a, "*")).join("")}</div></header>${renderFilters(panel.filters, params)}</section>${panel.tables.map((t) => renderTable(app, t, tz)).join("")}` : ""}

${app.status !== "planned" ? `<section><header><h3>Recent checks</h3><span class="label">last ${checks.length}</span></header><div class="tablewrap"><table><thead><tr><th>time</th><th>result</th><th class="num">http</th><th class="num">ms</th><th>error</th></tr></thead><tbody>${
    checks.length
      ? checks.map((c) => `<tr><td>${timeEl(c.ts, tz)}</td><td><span class="status"><span class="seed ${c.ok ? "up" : "down"}"></span>${c.ok ? "ok" : "failed"}</span></td><td class="num">${c.status ?? "–"}</td><td class="num">${c.ms ?? "–"}</td><td><span class="muted mono clip" style="font-size:12px" title="${esc(c.error || "")}">${esc(c.error || "")}</span></td></tr>`).join("")
      : `<tr><td colspan="5" class="muted" style="padding:22px 10px">No checks yet.</td></tr>`
  }</tbody></table></div></section>
<section><header><h3>Incidents</h3></header>${
    incidents.length
      ? `<div class="tablewrap"><table><thead><tr><th>started</th><th>duration</th><th>error</th></tr></thead><tbody>${incidents
          .map((x) => `<tr><td>${timeEl(x.started_at, tz)}</td><td>${x.resolved_at ? dur(x.resolved_at - x.started_at) : `<span class="tag">ongoing</span>`}</td><td class="mono muted" style="font-size:12px">${esc(x.error || "")}</td></tr>`)
          .join("")}</tbody></table></div>`
      : `<p class="muted">No incidents on record.</p>`
  }</section>` : ""}`;
  return layout(env, { title: app.name, user, active: "", body, extraCss: appCss });
}

// ---------- audit ----------
export function auditPage(env, { user, rows, list, tz }) {
  const body = `<div style="padding:clamp(28px,5vw,56px) 0 24px"><span class="label">audit log</span><h1 style="margin-top:10px">Who changed what<em>.</em></h1><p class="muted">Every admin action ends up here, with the person and the time. Entries are kept for a year.</p></div>
<div class="tablewrap"><table><thead><tr><th>time</th><th>person</th><th>service</th><th>action</th><th>target</th><th>result</th></tr></thead><tbody>${
    rows.length
      ? rows.map((r) => `<tr><td>${timeEl(r.ts, tz)}</td><td class="mono">${esc(r.actor)}</td><td><a href="/apps/${esc(r.app)}">${esc(list.find((a) => a.id === r.app)?.name || r.app)}</a></td><td><span class="tag">${esc(r.action)}</span></td><td class="mono">${esc(r.target || "")}</td><td class="muted">${esc(r.detail || "")}</td></tr>`).join("")
      : `<tr><td colspan="6" class="muted" style="padding:22px 10px">Nothing has been changed yet.</td></tr>`
  }</tbody></table></div>`;
  return layout(env, { title: "audit log", user, active: "audit", body });
}

export function errorPage(env, status, message) {
  return layout(env, { title: String(status), body: `<div style="padding:80px 0"><span class="label">${status}</span><h1 style="margin-top:10px">${esc(message)}<em>.</em></h1><p><a href="/">back to the overview</a></p></div>` });
}
