# T04 criteria implementation matrix

| Criteria | Implementation |
|---|---|
| C01–C02, C29–C33 | No application auth, account, invite, password, OAuth, or CAPTCHA. Public HTTP surface only. |
| C03 | Server fetches public DShield portdate aggregate. |
| C04–C09 | Main dashboard exposes value, unit, source, source-observed day/precision, fetch time, and Asia/Seoul. |
| C10 | One normalized reading object drives stored value and rendered API state; raw response SHA-256 is preserved. |
| C11 | No API keys required for chosen source; `npm run check` scans common secret patterns. Deployment data directory is not web-served. |
| C12–C16 | Official timeout/auth/rate/offline/schema fixtures map to distinct error codes. |
| C17–C18 | `applyError` never mutates current/daily good readings; UI labels stale. |
| C19 | Replay reset + timeout + `T04-RECOVER-D2` path supported publicly. |
| C20 | repository/domain upsert by `signal_id + record_date`; record id preserved. |
| C21 | next KST record date creates new row. |
| C22 | live repository preserves daily rows; final course submission must contain exactly two sealed `t04_day` receipts on distinct KST dates. |
| C23 | Each history row and `/api/evidence` expose source URL, source-observed value/precision, normalized value, and unit from the same preserved row. Canonical sealed receipts remain the course platform's responsibility. |
| C24 | UI delta is recomputed from preserved rows, not a separate upstream delta. |
| C25 | Only aggregate public telemetry is displayed/stored; no ModSecurity/private logs. |
| C26 | failure lab reads only `contract/fixtures/*.json`; live state is isolated. |
| C27 | See `docs/submission-template.md`. |
| C28 | See `docs/submission-template.md`. |
| C34 | Fill final public HTTPS dashboard URL at submission time. |
| C35 | Fill immutable GitHub source URL containing a 40-char commit SHA at submission time. |
