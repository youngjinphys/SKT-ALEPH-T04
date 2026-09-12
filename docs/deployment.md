# Deployment

## Recommended for this temporary two-day assignment: Vercel + Supabase
The page only needs two real live dates, but Vercel Functions cannot use their local filesystem as durable cross-request storage. Supabase is therefore used as a very small persistence layer: **one row (`state_key = 'live'`) containing the application JSON state**.

### 1. Supabase
Apply:

```sql
-- source of truth: supabase/migrations/202609120001_t04_live_state.sql
```

The migration creates only `public.t04_state`, enables RLS, removes `anon`/`authenticated` table grants, and grants server-side access to `service_role`. No browser code talks to Supabase.

### 2. Vercel environment
Set these values for Production (and Preview only if you intentionally want preview writes to the same temporary state):

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=<server-only secret key>
```

Do **not** use a publishable key for the backend writer and do not expose the secret through `public/`, `vercel.json`, Git, browser JS, or API responses.

`SUPABASE_SECRET_KEY` is the preferred current Supabase server key. The code accepts legacy `SUPABASE_SERVICE_ROLE_KEY` only for migration compatibility.

### 3. Vercel routing
`vercel.json` keeps the current frontend URLs unchanged and rewrites:
- `/api/status`
- `/api/evidence`
- `/api/live/refresh`
- `/api/replay/*`

to one Node Vercel Function (`api/router.mjs`). Official fixtures are bundled read-only into that function.

### 4. Why Failure Lab is not in Supabase
Synthetic replay is derived from a bounded fixture history stored in an `HttpOnly; Secure; SameSite=Strict` cookie. It never modifies the canonical live row. This keeps the database footprint fixed at one row and prevents public synthetic testing from generating arbitrary database rows.

## Two-real-date evidence sequence
- Day 1: press `LIVE REFRESH` once, verify one live row, and save the course sealed `t04_day` receipt.
- Day 2: preferably after **09:00 KST**, press `LIVE REFRESH` again, verify two live rows and the recomputed day-over-day delta, then save the second sealed receipt.
- Once two distinct KST live rows exist, the API intentionally refuses to create a third live day and does not call DShield again.
- The synthetic D1/D2 fixtures never replace these two real dates.

## Concurrency and integrity
The Supabase adapter stores a monotonically increasing `version`. Updates use `state_key + version` as a compare-and-swap condition and retry after a conflict. Two simultaneous Vercel invocations therefore cannot silently overwrite each other's state.

## Local/self-hosted fallback
`npm start` still uses the existing atomic JSON-file repository for offline development and deterministic tests. Docker + Nginx remains a valid alternative if a persistent volume is preferred, but it is unnecessary for this temporary two-day Vercel deployment once Supabase is configured.

## Pre-submission checks
- Open the production result URL and immutable GitHub commit URL in a new private/incognito window with no login.
- Confirm `GET /api/status` is HTTP 200 and reports `storage: "supabase"`.
- Confirm exactly two canonical `t04_day` receipts exist and their `server_created_at` values fall on different `Asia/Seoul` dates.
- Compare each receipt's `source_url`, `source_observed_at`, `normalized_value`, and `unit` against the history table and `/api/evidence`.
- Recompute record 2 minus record 1 and compare it with the visible delta.
- Run `npm test && npm run check` on the exact commit being submitted.
