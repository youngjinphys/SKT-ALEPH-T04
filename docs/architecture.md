# Architecture decisions

## Signal
`dshield.port22.reports.completed_utc_day` = SANS ISC / DShield `portdate` aggregate `records` for destination port 22 on the most recent **completed UTC day**.

Why this signal:
- public, non-personal, dynamic network-security telemetry;
- `records` is treated as submitted observation volume, not unique attackers or confirmed incidents;
- one scalar and one unit (`reports`) map cleanly to T04;
- aggregate only: no IP addresses, usernames, passwords, cookies, or private server logs;
- completed 24-hour windows make day-over-day values statistically comparable.

## Time semantics
T04's storage day is always `Asia/Seoul`, derived from `fetched_at`. DShield `portdate` exposes day precision rather than a second-level observation instant. The app canonicalizes that source day to `00:00:00Z`, stores `source_observed_precision = day`, and renders `YYYY-MM-DD UTC (day precision)` so it does not invent precision.

For clean source-day comparison, capture the second live record on the next KST date **after 09:00 KST**. At that point the most recently completed UTC day has also advanced.

## Trust boundary
Upstream is untrusted. Server code:
1. applies one total response deadline covering headers **and body**;
2. bounds successful response bodies to 256 KiB;
3. maps transport/HTTP failures to the T04 error model;
4. requires the requested date and, when the response declares a port, port 22;
5. requires `records` to be a non-negative safe integer;
6. validates the exact normalized-reading field set and RFC3339-like date-time string types;
7. hashes the raw successful response with SHA-256;
8. persists only the aggregate fields needed for audit.

Failures never overwrite the last good reading. A failure with no prior good value is rendered as **UNAVAILABLE / NO GOOD VALUE**, not as a stale value that does not exist.

## Persistence
The live implementation uses an atomic JSON-file repository for a **single self-hosted Node process**. Writes use temp-file + rename and an in-process transaction queue. Docker mounts a named volume.

This is deliberately not multi-replica/serverless persistence. For Vercel or multiple Node replicas, replace `JsonStateRepository` with a transactional datastore and enforce `UNIQUE(signal_id, record_date)` there.

## Live vs replay isolation
Live data is persisted in `live-state.json` only. Official synthetic fixtures never mutate it.

Browser Failure Lab sessions use an opaque per-tab/session identifier and are isolated in server memory with bounded count/TTL, so two public reviewers do not overwrite each other's replay state. The unscoped replay file remains available only for deterministic direct API/tests. Resetting synthetic state never resets live state.

## Evidence/provenance path
The same preserved daily rows drive:
- current value/unit and day-over-day delta;
- per-record history including public source URL and source-observed value;
- `/api/evidence` receipt preview.

There is no separately maintained “yesterday” number. The delta is recomputed from the two preserved rows.
