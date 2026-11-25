// Imprint (§ 5 DDG) and privacy policy (Art. 13 GDPR), in English and German.
// Every operator detail comes from the OPERATOR var in wrangler.jsonc, never from code.
// Keep the two languages in step: when one changes, change the other.
import { esc } from "./brand.js";
import { layout } from "./ui.js";
import { watchEnabled } from "./watch.js";

const UPDATED = { en: "Last updated 25 November 2026", de: "Stand: 25. November 2026" };

function operator(env) {
  let o = env.OPERATOR;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch { o = null; } }
  return o && o.name && o.email ? o : null;
}
const pick = (v, lang) => (v && typeof v === "object" ? v[lang] ?? v.en : v);

function address(o, lang) {
  const lines = [o.name, o.business, o.street, o.city, pick(o.country, lang) || (lang === "de" ? "Deutschland" : "Germany")].filter(Boolean);
  return `<address>${lines.map(esc).join("<br>")}</address>`;
}

const css = `
.legal-page{max-width:68ch;padding:clamp(28px,5vw,56px) 0 0}
.legal-page h1{margin:10px 0 6px}
.legal-page h2{font-size:22px;margin:34px 0 10px}
.legal-page p,.legal-page address{color:var(--ink);margin:0 0 14px;font-style:normal}
.legal-page .switch{margin-top:6px}
`;

function page(env, { lang, title, other, updated, body }) {
  const switchLink = lang === "de" ? `<a href="${other}" hreflang="en" lang="en">English version</a>` : `<a href="${other}" hreflang="de" lang="de">Deutsche Fassung</a>`;
  const html = `<article class="legal-page"><span class="label">${lang === "de" ? "rechtliches" : "legal"}</span><h1>${esc(title)}<em>.</em></h1>
<p class="muted switch">${updated ? `${esc(updated)} · ` : ""}${switchLink}</p>${body}</article>`;
  return layout(env, { title, body: html, extraCss: css, lang });
}

const missing = (lang) =>
  lang === "de"
    ? `<p>Die Betreiberangaben sind noch nicht hinterlegt. Wer field betreibt, trägt sie in der Variable OPERATOR ein.</p>`
    : `<p>The operator details have not been set yet. Whoever runs field adds them in the OPERATOR variable.</p>`;

export function imprint(env, lang) {
  const o = operator(env);
  const de = lang === "de";
  let body;
  if (!o) body = missing(lang);
  else
    body = `<p>${de ? "Angaben gemäß § 5 DDG:" : "Information pursuant to § 5 DDG:"}</p>${address(o, lang)}
<p>${de ? "E-Mail" : "Email"}: <a href="mailto:${esc(o.email)}">${esc(o.email)}</a>${o.phone ? `<br>${de ? "Telefon" : "Phone"}: <a href="tel:${esc(String(o.phone).replace(/[^\d+]/g, ""))}">${esc(o.phone)}</a>` : ""}</p>
${o.vatId ? `<p>${de ? "Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG" : "VAT ID pursuant to § 27a UStG"}: ${esc(o.vatId)}</p>` : ""}
<h2>${de ? "Verbraucherstreitbeilegung" : "Consumer dispute resolution"}</h2>
<p>${de ? "Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen." : "We are not willing or obliged to take part in dispute resolution proceedings before a consumer arbitration board."}</p>
<h2>${de ? "Open Source" : "Open source"}</h2>
<p>${de ? `field ist freie Software unter der GNU Affero General Public License, Version 3 oder später. Den Quellcode findest du <a href="${esc(env.SOURCE_URL || "https://github.com/shiftbloom-studio/field")}">hier</a>.` : `field is free software under the GNU Affero General Public License, version 3 or later. The source code is <a href="${esc(env.SOURCE_URL || "https://github.com/shiftbloom-studio/field")}">here</a>.`}</p>`;
  return page(env, { lang, title: de ? "Impressum" : "Imprint", other: de ? "/imprint" : "/impressum", body });
}

export function privacy(env, lang, host) {
  const o = operator(env);
  const de = lang === "de";
  const h = esc(host);
  const watch = watchEnabled(env);
  const controller = o
    ? `${address(o, lang)}<p>${de ? "E-Mail" : "Email"}: <a href="mailto:${esc(o.email)}">${esc(o.email)}</a></p>`
    : missing(lang);
  const authority = o && pick(o.authority, lang)
    ? (de ? `, etwa bei der an deinem Wohnort oder bei der für uns zuständigen: ${esc(pick(o.authority, lang))}` : `, for example the one where you live or the one responsible for us: ${esc(pick(o.authority, lang))}`)
    : (de ? ", etwa bei der an deinem Wohnort" : ", for example the one where you live");

  const body = de
    ? `<p>field ist das interne Dashboard von ${esc(env.ORG_NAME || "shiftbloom studio")}. Es zeigt, ob unsere Dienste laufen, und bietet einige Verwaltungsfunktionen für sie. Nur Mitglieder mit freigegebener E-Mail-Adresse können sich anmelden. field setzt keine eigenen Cookies, verwendet weder Tracking noch Werbung und trifft keine automatisierten Entscheidungen über dich. Diese Erklärung beschreibt, welche personenbezogenen Daten verarbeitet werden, wenn du ${h} nutzt.</p>
<h2>Verantwortlicher</h2>${controller}
<h2>Hosting</h2>
<p>Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA, liefert field in unserem Auftrag aus und betreibt den Worker, die Datenbank (D1) und die Anmeldung. Dazu verarbeitet Cloudflare deine IP-Adresse, die aufgerufene Adresse, den Zeitpunkt und Angaben, die dein Browser mitsendet, etwa den User-Agent. Anfragen an unseren Worker werden protokolliert, um Fehler zu finden; diese Protokolle werden nach spätestens 7 Tagen gelöscht. Schriften lädt dein Browser über field selbst, nicht von Dritten.</p>
<p>Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren und zuverlässigen Betrieb (Art. 6 Abs. 1 lit. f DSGVO). Cloudflare verarbeitet die Daten als unser Auftragsverarbeiter auf Grundlage eines Auftragsverarbeitungsvertrags (Art. 28 DSGVO). Cloudflare, Inc. ist nach dem EU-U.S. Data Privacy Framework zertifiziert, für das ein Angemessenheitsbeschluss der Europäischen Kommission besteht (Art. 45 DSGVO); der Vertrag enthält zusätzlich die EU-Standardvertragsklauseln. Mehr dazu in der <a href="https://www.cloudflare.com/de-de/privacypolicy/">Datenschutzerklärung von Cloudflare</a>.</p>
<h2>Anmeldung</h2>
<p>Vor field steht Cloudflare Access. Bei der Anmeldung verarbeitet Cloudflare deine E-Mail-Adresse und prüft, ob sie freigegeben ist. Nach der Anmeldung setzt Cloudflare das Cookie „CF_Authorization“, das dich für bis zu 24 Stunden angemeldet hält. Es ist für die Anmeldung technisch erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). field liest daraus nur deine E-Mail-Adresse, um sie oben rechts anzuzeigen und im Protokoll zu vermerken.</p>
<h2>Protokoll der Verwaltungsaktionen</h2>
<p>Wenn du in field etwas änderst, etwa einen Upload löschst oder eine Quelle neu synchronisierst, speichern wir deine E-Mail-Adresse, den Zeitpunkt, den Dienst, die Aktion, ihr Ziel und das Ergebnis. So bleibt nachvollziehbar, wer was geändert hat. Die Einträge werden nach einem Jahr gelöscht. Rechtsgrundlage ist unser berechtigtes Interesse an nachvollziehbaren Änderungen an unseren Diensten (Art. 6 Abs. 1 lit. f DSGVO).</p>
<h2>Verfügbarkeitsprüfungen</h2>
<p>field prüft alle fünf Minuten, ob unsere Dienste antworten, und speichert Ergebnis, Statuscode und Antwortzeit für 30 Tage. Diese Prüfungen enthalten keine personenbezogenen Daten.</p>${watch ? `
<h2>Kontoüberwachung</h2>
<p>field liest das Audit-Log unseres Cloudflare-Kontos, um Änderungen an den Zugangseinstellungen (Cloudflare Access) zu erkennen. Bei einer Änderung speichert field, was geändert wurde und wer es war (E-Mail-Adresse oder Name des API-Tokens), zeigt es unter „Incidents“ an und schickt es an unseren Alarmkanal. Die Einträge werden nach 30 Tagen gelöscht. Rechtsgrundlage ist unser berechtigtes Interesse an der Sicherheit unserer Dienste (Art. 6 Abs. 1 lit. f DSGVO).</p>` : ""}
<h2>Daten anderer Dienste</h2>
<p>Die Verwaltungsansichten zeigen Daten aus unseren anderen Diensten, etwa Dateinamen von Uploads oder Kanalnamen. field speichert sie nicht selbst, sondern liest sie bei jedem Aufruf aus der Datenbank des jeweiligen Dienstes. Für diese Daten gelten die Datenschutzerklärungen der jeweiligen Dienste.</p>
<h2>E-Mail</h2>
<p>Wenn du uns schreibst, nutzen wir deine Adresse und Nachricht nur, um dir zu antworten (Art. 6 Abs. 1 lit. f DSGVO), und löschen sie, sobald die Sache erledigt ist, es sei denn, das Gesetz verpflichtet uns zur Aufbewahrung.</p>
<h2>Deine Rechte</h2>
<p>Du hast das Recht auf Auskunft über deine personenbezogenen Daten (Art. 15 DSGVO), auf Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit (Art. 20). Schreib uns dazu eine E-Mail. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO)${authority}.</p>
<h2>Widerspruchsrecht</h2>
<p><strong>Du kannst der Verarbeitung deiner personenbezogenen Daten auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO jederzeit aus Gründen widersprechen, die sich aus deiner besonderen Situation ergeben (Art. 21 DSGVO).</strong></p>`
    : `<p>field is the internal dashboard of ${esc(env.ORG_NAME || "shiftbloom studio")}. It shows whether our services are running and offers a few admin functions for them. Only members with an approved email address can sign in. field sets no cookies of its own, uses no tracking or advertising and makes no automated decisions about you. This policy describes the personal data that is processed when you use ${h}.</p>
<h2>Controller</h2>${controller}
<h2>Hosting</h2>
<p>Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA, delivers field on our behalf and runs its Worker, its database (D1) and the sign-in. To do so, Cloudflare processes your IP address, the address you request, the time, and details your browser sends, such as its user agent. Requests to our Worker are logged so we can find errors; these logs are deleted after at most 7 days. Your browser loads fonts through field itself, not from third parties.</p>
<p>The legal basis is our legitimate interest in running field securely and reliably (Art. 6(1)(f) GDPR). Cloudflare processes the data as our processor under a data processing agreement (Art. 28 GDPR). Cloudflare, Inc. is certified under the EU-U.S. Data Privacy Framework, for which the European Commission has adopted an adequacy decision (Art. 45 GDPR); the agreement also contains the EU standard contractual clauses. More in <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a>.</p>
<h2>Sign-in</h2>
<p>field sits behind Cloudflare Access. When you sign in, Cloudflare processes your email address and checks whether it is approved. After sign-in, Cloudflare sets the cookie "CF_Authorization", which keeps you signed in for up to 24 hours. It is strictly necessary for signing in (§ 25(2) no. 2 TDDDG). field reads only your email address from it, to show it in the header and to note it in the audit log.</p>
<h2>Audit log</h2>
<p>When you change something in field, for example delete an upload or re-sync a source, we store your email address, the time, the service, the action, its target and the result, so it stays clear who changed what. Entries are deleted after one year. The legal basis is our legitimate interest in traceable changes to our services (Art. 6(1)(f) GDPR).</p>
<h2>Health checks</h2>
<p>Every five minutes field checks whether our services answer and keeps the result, status code and response time for 30 days. These checks contain no personal data.</p>${watch ? `
<h2>Account monitoring</h2>
<p>field reads the audit log of our Cloudflare account to spot changes to the sign-in settings (Cloudflare Access). When something changes, field stores what changed and who changed it (email address or API token name), shows it under Incidents and sends it to our alert channel. These entries are deleted after 30 days. The legal basis is our legitimate interest in keeping our services secure (Art. 6(1)(f) GDPR).</p>` : ""}
<h2>Data from other services</h2>
<p>The admin views show data from our other services, such as file names of uploads or channel names. field doesn't store it itself; it reads it from that service's database each time you open the view. That data is covered by the privacy policy of the service it belongs to.</p>
<h2>Email</h2>
<p>If you email us, we use your address and message only to reply (Art. 6(1)(f) GDPR) and delete them once the matter is settled, unless the law requires us to keep them.</p>
<h2>Your rights</h2>
<p>You have the right of access to your personal data (Art. 15 GDPR), to rectification (Art. 16), to erasure (Art. 17), to restriction of processing (Art. 18) and to data portability (Art. 20). To exercise them, email us. You can also lodge a complaint with a data protection supervisory authority (Art. 77 GDPR)${authority}.</p>
<h2>Right to object</h2>
<p><strong>You may object at any time, on grounds relating to your particular situation, to the processing of your personal data based on Art. 6(1)(f) GDPR (Art. 21 GDPR).</strong></p>`;
  return page(env, { lang, title: de ? "Datenschutzerklärung" : "Privacy policy", other: de ? "/privacy" : "/datenschutz", updated: UPDATED[lang], body });
}
