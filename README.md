# field

The intranet hub of shiftbloom studio. One page that tells you whether everything is up, and one place to clean up after your apps.

field runs as a single Cloudflare Worker behind Cloudflare Access. Every five minutes it checks each service, writes the result to D1 and turns two failed checks in a row into an incident. For apps it knows, it also shows usage numbers and a few admin actions: delete an upload, reset a rate limit, sign a streamer out, queue a re-sync.

## What you get

- **Overview** of all services with live status, 24-hour uptime strip, response time and the two most useful numbers per app.
- **Detail page** per service: uptime for 24 h / 7 days / 30 days, a 7-day strip, the last checks, incidents and the raw health response.
- **Admin screens** for the apps that have an adapter:

  | App | Numbers | Actions |
  | --- | --- | --- |
  | [drop](https://github.com/shiftbloom-studio/drop) (uploads, pastes, links) | items, storage, views, NSFW flags, expiring soon, token requests waiting | search, filter, delete (through drop's own delete route), approve or reject token requests |
  | convert (file conversion) | jobs, running, failed, output volume, daily quota | delete a job and its files, reset a daily quota counter |
  | [grow](https://github.com/shiftbloom-studio/grow) (OBS to-do overlays) | channels, active, Twitch-linked, open sessions | sign a channel out, delete a channel |
  | [roots](https://github.com/shiftbloom-studio/roots) (knowledge base) | documents, chunks, sources, last indexed | re-sync one source or all of them |
  | [rhizome](https://github.com/shiftbloom-studio/rhizome) (memory for AI agents) | people, agent clients, active keys, last key use | add an agent client together with its first key |
  | [leaf](https://github.com/shiftbloom-studio/leaf) (pastebin) | pastes, text stored, views, new today, expiring soon | search, filter anonymous pastes, delete a paste (with the optional `LEAF_PASTES` R2 binding) |

- **API tokens** for the apps that have an API (drop, rhizome and leaf): create a token with a label and an expiry date, see when it was last used, revoke it. The token is shown once, right after it's created, in the response itself (never in a URL or the audit log). The apps store and check only its SHA-256 hash and refuse it once it has expired or was revoked. See [API tokens](#api-tokens).
- **Token requests** from drop's public form: approve for 90 days or a year, or reject. field only records the decision; drop generates the token when the requester collects it through their private link, so field never sees it.
- **Protocol** of every admin action, with who did it and when.
- **Alerts** by email and/or to a Discord or Slack webhook when something goes down and when it comes back. Each change is sent once, never every five minutes.
- **Imprint and privacy policy** in English and German (`/imprint`, `/impressum`, `/privacy`, `/datenschutz`), filled from the `OPERATOR` config. They are the only pages reachable without signing in; give them a bypass rule in your Access application.
- **`/api/status`** as JSON, for scripts and agents (send a Cloudflare Access service token).
- Placeholders for services that don't exist yet, so the overview already shows what's coming.

## How the checks work

field prefers [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) over public URLs. The request never leaves Cloudflare, costs nothing extra and isn't blocked by the Access login of the app it checks. Apps without a binding are fetched over their public `url`.

A check passes when the HTTP status is 2xx/3xx (or one of the statuses in `expect`) and, if `db` is set, a `SELECT 1` against that D1 database succeeds. roots answers `401` to anything without an Access token, so its entry expects exactly that.

## Configuration

Everything tenant-specific lives in `wrangler.jsonc`:

| Var | Meaning |
| --- | --- |
| `APPS` | list of services (see below) |
| `LINKS` | extra shortcuts on the overview: `{ name, url, note }` |
| `ACCESS_TEAM_DOMAIN` | e.g. `yourteam.cloudflareaccess.com` |
| `ACCESS_AUD` | AUD tag of the Access application in front of field |
| `TZ` | time zone for dates, default `Europe/Berlin` |
| `RETENTION_DAYS` | how long check history is kept, default 30 |
| `ORG_NAME`, `SOURCE_URL` | footer text and source link |
| `OPERATOR` | your details for the imprint and privacy policy (see `wrangler.jsonc`) |
| `ALERT_WEBHOOK` (secret) | optional Discord/Slack incoming webhook |
| `ALERT_MAIL` (send_email binding), `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` | optional alert emails through [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/); the sender's domain must be onboarded |
| `CF_API_TOKEN` (secret), `CF_ACCOUNT_ID` | optional, turn on the account watchers below |
| `AI_HOURLY_NEURONS`, `AI_DAILY_USD` | Workers AI alert limits, default 2,000,000 neurons per hour and 7 USD per day |
| `ACCESS_WATCH_PRODUCTS` | audit log products to watch for changes, comma separated, default `access` |

An entry in `APPS`:

```jsonc
{
  "id": "drop",                 // slug, used in URLs and the database
  "name": "drop",
  "url": "https://drop.example.com",
  "blurb": "Files, pastes and short links",
  "service": "DROP",            // service binding name (optional)
  "health": "/health",          // path to probe, default "/"
  "expect": [200],              // optional, default: any 2xx/3xx
  "db": "DROP_DB",              // optional D1 binding to ping
  "adapter": "drop"             // optional: drop | convert | grow | roots | rhizome | leaf
}
```

Set `"status": "planned"` for a service that isn't live yet. Adapters switch themselves off when their bindings are missing, so you can run field with only health checks.

## Self-hosting

```sh
npm install
npx wrangler d1 create field-db          # put the id into wrangler.jsonc
npm run db:migrate
npx wrangler deploy
```

Then, in Cloudflare Zero Trust, create a self-hosted Access application for field's hostname, copy its AUD tag into `ACCESS_AUD` and deploy again. Add a second Access application with a Bypass policy for the legal pages (`/privacy`, `/datenschutz`, `/imprint`, `/impressum`) plus `/favicon.svg` and `/assets/*`, so anyone can read them. Without a valid Access token field answers only those pages and `/health`.

For the admin adapters, add the D1 ids of your apps (and the R2 bucket / queue where listed) to `wrangler.jsonc`. field writes to those databases, so only give it the ones you want to manage from here.

## API tokens

field writes tokens straight into the app's own D1 database, in the format that app checks:

| App | Table | Token | Times | Needs |
| --- | --- | --- | --- | --- |
| drop | `api_tokens` | `drop_` + 40 characters | unix seconds | drop migration `0004_api_tokens.sql` |
| rhizome | `api_keys` (one client per agent and provider) | `rz_` + 32 characters | epoch milliseconds | rhizome migration `0002_key_label_expiry.sql` |
| leaf | `api_tokens` | `leaf_` + 40 characters | unix seconds | leaf migration `0001_init.sql` |

Expiry choices are 30, 90 or 180 days, one year, a date (end of that day, UTC) or never. Creating and revoking are written to the audit log with label and token prefix. For rhizome you either pick an existing agent client or choose *new agent…* and enter its agent and provider slugs; the new client gets rhizome's default grants (shared profile, all projects, its own agent scope).

To add tokens for another app, give its adapter a `tokens` provider (`list`, `create`, `revoke`, optional `fields`), see `src/tokens.ts` and the types in `src/types.ts`.

## Development

```sh
cp .dev.vars.example .dev.vars
npm run dev      # Access check is skipped on localhost only
npm test         # boots field in Miniflare with fake apps and runs every page and action
```

No build step: the Worker is plain ES modules.

## License

[AGPL-3.0-or-later](LICENSE). If you run a modified field for other people, offer them the source; the footer link (`SOURCE_URL`) is there for that.

## Account watchers

Two things Cloudflare's own notifications don't cover, checked from the same cron:

- **Workers AI usage.** Once an hour field sums the neurons of the last hour and of the day so far (GraphQL `aiInferenceAdaptiveGroups`). It opens an incident and sends an alert when the last hour is above `AI_HOURLY_NEURONS`, or when the day so far, extrapolated to 24 hours, would cost more than `AI_DAILY_USD`. The incident closes once usage is back under both limits.
- **Access changes.** Every five minutes field reads the account audit log for anything other than a read on Access (`ACCESS_WATCH_PRODUCTS`) since the last run, and posts one alert listing the changes. The first run only sets the starting point.

Both show up under Incidents on the overview and go to the alert channels (email and/or `ALERT_WEBHOOK`). They need a read-only API token, stored as the `CF_API_TOKEN` secret, plus `CF_ACCOUNT_ID`:

1. Cloudflare dashboard → Manage account → Account API tokens → Create token → Create custom token.
2. Permissions: Account · Account Analytics · Read, and Account · Account Settings · Read. Nothing else.
3. Account resources: include only the account field runs in. Optionally set an expiry and IP filtering.
4. `npx wrangler secret put CF_API_TOKEN` and paste the token.
