# Objective design and QA review

## Decision
Use one public, non-personal, security-relevant signal: SANS ISC / DShield port 22 `records` for the most recent completed UTC day. Treat it as **submitted observation reports**, not unique attackers or confirmed compromises.

This remains preferable to the user's ModSecurity audit log for this assignment: the contract asks for a public non-personal source, while private WAF logs can contain IP addresses, headers, cookies, query values, request bodies, and other operationally sensitive material.

## Why a completed UTC day
A rolling/current-day counter creates unequal observation windows and makes a day-over-day delta misleading. A completed UTC day gives equal 24-hour source windows. The app then stores each actual fetch under its `Asia/Seoul` `record_date`, as required by the contract.

After one completed UTC source day is preserved, repeated refreshes reuse it instead of hammering the upstream. In Korea the next completed UTC source day normally becomes available after 09:00 KST.

## Findings discovered by adversarial review and fixed
- **Schema trust gap:** the adapter previously accepted the first matching date without checking an explicitly returned port. It now rejects a declared non-22 port.
- **Numeric coercion:** `null` could be coerced to `0`, malformed comma grouping could be silently normalized, and fractional report counts were accepted. `records` is now a non-negative safe integer with strict numeric-string parsing; null/blank/malformed values are rejected.
- **Incomplete timeout:** the initial deadline could end after response headers while body download continued. One total deadline now covers both phases.
- **Unbounded upstream body:** successful bodies are capped at 256 KiB using both declared and actual byte size.
- **Retry semantics:** `Retry-After` now supports both delta-seconds and HTTP-date. 5xx responses are represented as upstream availability failure rather than schema drift.
- **Public replay interference:** browser Failure Lab state is now session-isolated instead of being one global mutable demo state.
- **Dishonest first failure label:** a failure before any successful reading now says `UNAVAILABLE / NO GOOD VALUE`; `STALE / LAST GOOD VALUE` is reserved for cases where a last good value really exists.
- **C23 provenance visibility:** each live history row now exposes its source-observed value and public source URL, rather than only exposing provenance for the current row.
- **Contract schema fidelity:** normalized date/time fields now require date-time strings instead of accepting values merely coercible by JavaScript `Date`.
- **Readability:** sub-10px persistent text and several low-contrast utility labels were raised while preserving the cyber/terminal visual system.
- **Contract tamper detection:** `npm run check` now verifies all 17 files listed by the supplied contract asset manifest by byte size and SHA-256, in addition to checking all 35 criterion IDs.
- **Deployment hygiene:** the fake upstream contact fallback was removed. Plain Node and Docker Compose now default the User-Agent contact field to this real public repository URL, with an explicit override available when needed.

## Verification performed
- Automated domain/adapter/server suite: 28 tests, including official D1/D2 transitions, five failure classes, recovery, malformed upstream data, body timeout/size limit, replay session isolation, provenance, and two-row evidence/delta consistency.
- Static checks: source secret scan, exact T04-C01…C35 registry check, and official 17-file contract SHA-256 verification.
- Rendered Playwright QA on desktop 1440×1000 and mobile 390×844.
- Browser interaction: RESET → D1-A → D1-B → TIMEOUT produces stale/timeout + 105 pt + one row; Retry → RECOVER-D2 produces fresh/none + 120 pt + two rows.
- First-live-failure UI verified: no existing good reading is falsely represented as stale.
- Seeded two-live-row display verified: `975 reports`, `+75 reports`, two provenance rows, two public source URLs, and `2 / 2 actual KST dates ready` with no viewport-level horizontal overflow.
- Persistent visible leaf text below 10 px after the final typography pass: zero in tested desktop/mobile states.

## Test-environment limitation
The managed Chromium environment blocks direct URL navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`). Render QA therefore used the exact project HTML/CSS/JS with Playwright and forwarded its `/api/*` requests to the running Node server. This still exercises the real frontend logic and backend API, but it is not a substitute for a final smoke test on the deployed HTTPS URL.

The container also cannot complete the real DShield network request. SANS' current public documentation and current public port-22 pages were cross-checked, and the live adapter was exercised against realistic mocked upstream responses. A **real production DShield fetch remains a mandatory deployment-time test** before sealing the first receipt.

## Remaining external submission dependencies
The ZIP cannot truthfully complete these on its own:
1. two canonical `t04_day` receipts on different real `Asia/Seoul` dates;
2. public HTTPS deployment;
3. public source URL pinned to the exact 40- or 64-character lowercase commit hash;
4. final incognito/public-access smoke test against the deployed URLs.

## Residual grading risk
DShield `portdate` provides a source **date**, not a second-level observation instant. The application canonicalizes that day to `00:00:00Z` only for the receipt schema and explicitly displays `day precision`. This is semantically honest and consistent with the upstream. If the evaluator interprets C07/C23 as requiring a source-provided second-level timestamp, the source should be changed **before** the two canonical live receipts are sealed rather than fabricating precision.
