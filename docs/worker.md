# TestPilot worker

The durable worker is a separate process using the same image and database as
the web application.

Apply migrations before starting it:

```bash
npx prisma migrate deploy
```

Start the worker service with:

```bash
npm run worker
```

Configuration:

- `WORKER_ID`: optional stable instance name.
- `WORKER_POLL_MS`: queue polling interval, default `1000`.
- `WORKER_LEASE_MS`: claim lease, default `60000`.
- `ALLOW_PRIVATE_TEST_TARGETS`: development-only private target override.
- `USE_LEGACY_LOOP`: set to `true` to roll new sessions back from the durable
  pipeline to the in-process `/loop` route. The default is the durable pipeline.

Run the worker as a distinct Railway service with `npm run worker` as its start
command. Do not enable `ALLOW_UNSANDBOXED_IMPORTED_TESTS` in production.

Before removing the legacy route, compare representative completed sessions:

```bash
npm run compare:pipeline -- <legacy-session-id> <pipeline-session-id>
```

The comparison fails when sitemap, generated-suite, profile, execution, triage,
or Figma coverage falls below the configured parity thresholds.
