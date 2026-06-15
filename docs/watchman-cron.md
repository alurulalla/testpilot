# Watchman cron (E4)

The **watchman** is a scheduled health pass. For every app that has a profile it
recomputes feature health and surfaces what a human would want flagged between
manual runs: critical coverage gaps, flaky features, and features below an 80%
pass rate. It is **read-only** (no test re-runs, no token cost).

- Logic: [`lib/watchman.ts`](../lib/watchman.ts)
- Endpoint: `GET|POST /api/cron/watchman` ([route](../app/api/cron/watchman/route.ts))

## 1. Set the secret

Add an env var on the TestPilot service (Railway → Variables):

```
CRON_SECRET=<a long random string>
```

The endpoint rejects any request whose `Authorization: Bearer <CRON_SECRET>`
(or `?key=<CRON_SECRET>`) doesn't match. Without the secret set, it returns 503.

## 2. Add a Railway cron service

Railway → your project → **New → Cron Job** (or a service with a cron schedule).
Set the schedule (e.g. every 6 hours) and the command to call the endpoint:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "https://<your-app>.up.railway.app/api/cron/watchman"
```

Suggested schedule (cron syntax): `0 */6 * * *` (every 6 hours).

## 3. Verify

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-app>.up.railway.app/api/cron/watchman
```

Returns `{ ok: true, apps: N, reports: [...] }`. The per-app summary is also
written to the service logs (`[watchman] <host>: …`).

## Opt-in: auto-rerun (not enabled)

The watchman intentionally does **not** re-run suites — that costs tokens/compute
and needs a cadence + cost decision. When you're ready, the extension point is
`runWatchman()` in `lib/watchman.ts`: per app, trigger the existing run pipeline
for the latest session (guard it behind a `WATCHMAN_AUTORUN=true` env so it stays
explicit). Notifications (email/Slack) can hang off the same report.
