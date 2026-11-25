// shiftbloom brand book v2: paper and ink, one loud flower.
// Bloom Red for actions and seeds, gradients only inside the mark.

import { bloomSvg, faviconSvg } from "./bloom.ts";

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[c]);

// The bloom is the exact mark from shiftbloom.studio, see ./bloom.js.
/** Gradient bloom as in the shiftbloom.studio header; `solid` for favicons and sizes below 32px. */
export function bloom({ size = 30, solid = false, id = "sb-bloom-ring", anim = false, cls = "" }: { size?: number; solid?: boolean; id?: string; anim?: boolean; cls?: string } = {}): string {
  return bloomSvg({ size, variant: solid ? "solid" : "gradient", id, anim, cls: `bloom ${cls}`.trim() });
}

export { faviconSvg };

export const SPARK = (size: number, color = "#FF2E52"): string =>
  `<svg class="sprinkle-svg" width="${size}" height="${size}" viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0-12C1 -3 3 -1 12 0C3 1 1 3 0 12C-1 3-3 1-12 0C-3-1-1-3 0-12Z" fill="${color}"/></svg>`;

export const css = `
:root{--bloom:#FF2E52;--root:#C81040;--petal:#FF8FAB;--blush:#FFE9EF;--ink:#1A1216;--ink60:rgba(26,18,22,.62);--ink40:rgba(26,18,22,.45);--line:rgba(26,18,22,.12);--paper:#F6F1EE;--warm:#EEE6E2;
--ok:#1A1216;--display:"Clash Display",ui-sans-serif,system-ui,sans-serif;--sans:"General Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
--ease:cubic-bezier(.22,1.1,.36,1);--settle:cubic-bezier(.4,0,.2,1)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
::selection{background:var(--blush)}
a{color:var(--root);text-decoration:none;background:linear-gradient(var(--root),var(--root)) 0 100%/0 1px no-repeat;transition:background-size .24s var(--ease)}
a:hover{background-size:100% 1px}
.wrap{max-width:1180px;margin:0 auto;padding:0 clamp(18px,4vw,44px)}
.label{font:500 11px/1.4 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--ink40)}
.mono{font-family:var(--mono);font-size:13px}
.muted{color:var(--ink60)}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 0;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:12px;color:var(--ink);background:none}
.brand .word{font:600 20px/1 var(--display);letter-spacing:-.02em}@media(min-width:640px){.brand .word{font-size:22.4px}}
.brand .word i{font-style:normal;color:var(--bloom)}
.brand .by{font:600 14px/1 var(--display);letter-spacing:-.02em;color:var(--ink)}.brand .by .studio{font-weight:400;color:var(--ink60)}.brand .by i{font-style:normal;color:var(--bloom)}
@media(max-width:480px){.brand .by{display:none}}
@media(max-width:640px){nav .who{display:none}}
nav{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
nav a{font:500 11px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--ink60);background:none;padding:6px 0;position:relative}
nav a:hover,nav a.on{color:var(--ink)}
nav a.on:after{content:"";position:absolute;left:50%;bottom:-6px;width:6px;height:6px;margin-left:-3px;border-radius:50%;background:var(--bloom)}
nav .who{color:var(--ink40);text-transform:none;letter-spacing:0;font:400 12px/1 var(--mono)}
h1,h2,h3{font-family:var(--display);font-weight:600;letter-spacing:-.025em;line-height:1.04;margin:0}
h1{font-size:clamp(36px,5.4vw,60px)}h1 em{font-style:normal;color:var(--bloom)}
h2{font-size:26px}h3{font-size:20px}
.btn{appearance:none;border:0;border-radius:999px;background:var(--bloom);color:#fff;font:600 14px/1 var(--sans);padding:12px 18px;cursor:pointer;transition:background .24s var(--settle),transform .24s var(--ease);display:inline-flex;align-items:center;gap:8px;text-decoration:none;white-space:nowrap}
.btn:hover{background:var(--root)}.btn:active{transform:scale(.97)}
.btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}
.btn.ghost:hover{box-shadow:inset 0 0 0 1px var(--ink)}
.btn.sm{padding:9px 14px;font-size:13px}
.btn.danger{background:transparent;color:var(--root);box-shadow:inset 0 0 0 1px rgba(200,16,64,.35)}
.btn.danger:hover{background:var(--root);color:#fff}
input,select{font:14px/1.4 var(--sans);color:var(--ink);background:#FBF8F6;border:1px solid var(--line);border-radius:999px;padding:9px 14px;transition:border-color .24s var(--settle),box-shadow .24s var(--settle)}
input:focus,select:focus{outline:0;border-color:var(--bloom);box-shadow:0 0 0 3px var(--blush)}
.panel{background:var(--warm);border-radius:20px;padding:clamp(16px,2.4vw,26px)}
.seed{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--ink);flex:none}
.seed.up{background:var(--ink)}.seed.down{background:var(--bloom);box-shadow:0 0 0 4px var(--blush);animation:pulse 2s var(--settle) infinite}
.seed.warn{background:var(--petal)}.seed.idle{background:transparent;box-shadow:inset 0 0 0 1.5px var(--ink40)}
@keyframes pulse{50%{box-shadow:0 0 0 7px rgba(255,233,239,.4)}}
.strip{display:flex;gap:2px;height:26px;align-items:stretch}
.strip i{flex:1;border-radius:2px;background:var(--ink);opacity:.85;transition:transform .24s var(--ease)}
.strip i.none{background:var(--line);opacity:1}.strip i.bad{background:var(--bloom);opacity:1}.strip i.mid{background:var(--petal);opacity:1}
.strip i:hover{transform:scaleY(1.15)}
.tag{display:inline-block;font:500 10px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;background:var(--blush);color:var(--root);border-radius:999px;padding:5px 9px;white-space:nowrap}
.tag.plain{background:#FBF8F6;color:var(--ink60);box-shadow:inset 0 0 0 1px var(--line)}
table{width:100%;border-collapse:collapse}
th{font:500 10px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink40);text-align:left;padding:10px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:10px;border-bottom:1px solid var(--line);vertical-align:middle}
th.num{text-align:right}td.num{text-align:right;font-family:var(--mono);font-size:13px}
td.act{text-align:right;white-space:nowrap}td.act form{display:inline}
td .clip{display:inline-block;max-width:34ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
tr:hover td{background:rgba(255,233,239,.35)}
.tablewrap{overflow-x:auto;background:#FBF8F6;border-radius:16px;box-shadow:inset 0 0 0 1px var(--line);padding:4px 8px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.tile{background:var(--warm);border-radius:16px;padding:16px 18px}
.tile b{display:block;font:600 28px/1.1 var(--display);letter-spacing:-.02em;margin-top:6px}
.tile.warn b{color:var(--root)}
.tile small{display:block;color:var(--ink60);font-size:12px;margin-top:4px}
.flash{border-radius:14px;padding:12px 16px;margin:20px 0 0;font-size:14px;display:flex;gap:10px;align-items:center}
.flash.ok{background:var(--warm)}.flash.err{background:var(--blush);color:var(--root)}
.foot .legal a{color:inherit}
.foot{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:22px 0 30px;margin-top:72px;border-top:1px solid var(--line)}
.unfold{animation:unfold .6s var(--ease) both}
@keyframes unfold{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}
`;
