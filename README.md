# Security Pulse — ALEPH T04

A public cyber-telemetry information board for ALEPH T04. It records one real, non-personal, public value: **SANS ISC / DShield port 22 submitted report count for the most recent completed UTC day**.

The project is deliberately temporary: it preserves **exactly the two real KST dates needed for the assignment**, computes the delta, and then stops accepting a third live day.

## What it demonstrates
- real public dynamic source;
- value, unit, source, source-observed day/precision, source period, fetch time, and Asia/Seoul storage date;
- same-KST-day upsert and a hard two-day capture boundary;
- delta recomputed from the two preserved daily readings;
- honest `fresh`/`stale` semantics;
- five deterministic failure classes and visible retry/recovery using the official fixtures;
- per-record provenance (source URL / observed day / digest);
- data minimization: aggregate count only, no private ModSecurity logs or individual IP records;
- SHA-256 provenance digest for each successful upstream raw response.

## Storage design
Production on Vercel uses **Supabase only for one `t04_state` row**. That JSON state contains at most two live daily readings. There are no user/auth tables and no raw attack-event rows.

Synthetic Failure Lab state is not stored in Supabase. Vercel reconstructs it from a bounded, HttpOnly/Secure/SameSite replay-history cookie, so public testing cannot fill the database with synthetic rows.

The browser never receives a Supabase key. `SUPABASE_SECRET_KEY` is used only by the Vercel Function. Supabase's current secret-key model is preferred; the repository keeps legacy `SUPABASE_SERVICE_ROLE_KEY` compatibility only in server code.

## Local verification
```bash
npm test
npm run check
npm start
# http://localhost:4173
```

The existing local Node server keeps its file repository for deterministic offline development/tests. The Vercel production API uses `src/supabase-repository.mjs`.

## Vercel + Supabase production
1. Create a Supabase project.
2. Apply `supabase/migrations/202609120001_t04_live_state.sql`.
3. Set `SUPABASE_URL` and **server-only** `SUPABASE_SECRET_KEY` in the Vercel project.
4. Redeploy. `vercel.json` routes the existing `/api/*` frontend calls to one Node function.
5. Verify `/api/status` returns `storage: "supabase"` without login.

See `docs/deployment.md` for the exact evidence sequence.

## Important timing
T04 needs exactly two canonical live receipts whose `server_created_at` fall on different Asia/Seoul dates. For scientifically clean DShield day-over-day comparison, make the second live capture on the next KST date after **09:00 KST**, when the completed UTC source day has advanced too.

After the second distinct KST live row is stored, `LIVE REFRESH` serves the completed state and does not call DShield or create a third row.

## Contract
The provided public contract and fixtures are copied under `contract/` unmodified for reproducible local testing. `npm run check` verifies the 17 manifest-listed files by byte size and SHA-256 before submission.
