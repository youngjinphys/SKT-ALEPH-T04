# Security Pulse — ALEPH T04

A public cyber-telemetry information board for ALEPH T04. It records one real, non-personal, public value: **SANS ISC / DShield port 22 submitted report count for the most recent completed UTC day**.

The project is designed around the supplied 35-condition public contract rather than around visual demo data.

## What it demonstrates
- real public dynamic source;
- value, unit, source, source-observed day/precision, source period, fetch time, and Asia/Seoul storage date;
- one-row-per-KST-day upsert;
- delta recomputed from preserved daily readings;
- honest `fresh`/`stale` semantics;
- five deterministic failure classes and visible retry/recovery using the official fixtures;
- per-record provenance (source URL / observed day / digest) for the two-live-day review path;
- data minimization: aggregate count only, no private ModSecurity logs or individual IP records;
- SHA-256 provenance digest for each successful upstream raw response.

## Run
```bash
npm test
npm run check
npm start
# http://localhost:4173
```

No dependency installation is needed beyond Node.js 20+.

## Production
The included persistence adapter targets a single persistent self-hosted Node process. For the user's existing Nginx host, the recommended deployment is `docker compose up -d --build` and an HTTPS reverse proxy. See `docs/deployment.md`.

## Important timing
T04 needs exactly two canonical live receipts whose `server_created_at` fall on different Asia/Seoul dates. For scientifically clean DShield day-over-day comparison, make the second live capture on the next KST date after 09:00 KST, when the completed UTC source day has advanced too.

## Contract
The provided public contract and fixtures are copied under `contract/` unmodified for reproducible local testing. `npm run check` verifies the 17 manifest-listed files by byte size and SHA-256 before submission.
