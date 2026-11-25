# field

The intranet hub of shiftbloom studio. One page that tells you whether everything is up, and one place to clean up after your apps.

field runs as a single Cloudflare Worker behind Cloudflare Access. Every five minutes it checks each service, writes the result to D1 and turns two failed checks in a row into an incident. For apps it knows, it also shows usage numbers and a few admin actions: delete an upload, reset a rate limit, sign a streamer out, queue a re-sync.

## What you get

- **Overview** of all services with live status, 24-hour uptime strip, response time and the two most useful numbers per app.
- **Detail page** per service: uptime for 24 h / 7 days / 30 days, a 7-day strip, the last checks, incidents and the raw health response.
- **Admin screens** for the apps that have an adapter:

  | App | Numbers | Actions |
  | --- | --- | --- |
  | [drop](https://github.com/shiftbloom-studio/drop) (uploads, pastes, links) | items, storage, views, NSFW flags, expiring soon | search, filter, delete (through drop's own delete route) |
  | convert (file conversion) | jobs, running, failed, output volume, daily quota | delete a job and its files, reset a daily quota counter |
  | [grow](https://github.com/shiftbloom-studio/grow) (OBS to-do overlays) | channels, active, Twitch-linked, open sessions | sign a channel out, delete a channel |
  | [roots](https://github.com/shiftbloom-studio/roots) (knowledge base) | documents, chunks, sources, last indexed | re-sync one source or all of them |

- **Protocol** of every admin action, with who did it and when.
- **Alerts** to a Discord or Slack webhook when something goes down and when it comes back.
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
  "adapter": "drop"             // optional: drop | convert | grow | roots
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

## Development

```sh
cp .dev.vars.example .dev.vars
npm run dev      # Access check is skipped on localhost only
npm test         # boots field in Miniflare with fake apps and runs every page and action
```

No build step: the Worker is plain ES modules.

## License

[AGPL-3.0-or-later](LICENSE). If you run a modified field for other people, offer them the source; the footer link (`SOURCE_URL`) is there for that.
