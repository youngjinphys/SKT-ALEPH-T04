# Deployment

## Recommended: Docker + existing Nginx
1. `UPSTREAM_CONTACT_URL` defaults to this public repository URL (`https://github.com/youngjinphys/SKT-ALEPH-T04`) so the upstream User-Agent is useful even for a plain `npm start` or `docker compose up`. Copy `.env.example` to `.env` only if you intentionally need to override it; it is not a secret.
2. Run `docker compose up -d --build`.
3. Use a dedicated HTTPS subdomain and proxy `/` to `127.0.0.1:4173` (see `deploy/nginx-example.conf`).
4. Keep the named Docker volume; it is the durable live-state layer.

The container binds only to loopback on the host. Nginx is the public ingress. The container runs as non-root, drops Linux capabilities, uses `no-new-privileges`, and is read-only except for the named data volume.

## Why not plain Vercel for this version
A browser-only store does not satisfy cross-browser public review, and function-local filesystems are not durable storage. If deployment must be Vercel/serverless, replace only the repository adapter with a transactional database such as Postgres; do not rely on `/tmp` or function filesystem state.

## Two-real-date evidence sequence
- Day 1: deploy, press `LIVE REFRESH` once, verify one live row and save the course sealed `t04_day` receipt.
- Day 2: preferably after **09:00 KST**, press `LIVE REFRESH` again, verify two live rows and the recomputed day-over-day delta, then save the second sealed receipt.
- Do not create more than the required two canonical course receipts before grading. The synthetic D1/D2 fixtures do not replace these two real dates.

## Pre-submission checks
- Open the result URL and immutable source URL in a new private/incognito window with no login.
- Confirm exactly two canonical `t04_day` receipts exist and their `server_created_at` values fall on different `Asia/Seoul` dates.
- Compare each receipt's `source_url`, `source_observed_at`, `normalized_value`, and `unit` against the history table and `/api/evidence`.
- Recompute record 2 minus record 1 and compare it with the visible delta.
- Run `npm test && npm run check` on the exact commit being submitted.
- Confirm the submitted source URL includes the full 40- or 64-hex lowercase commit identifier.
