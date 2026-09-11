# Data source review — SANS ISC / DShield

Primary endpoint pattern: `https://isc.sans.edu/api/portdate/22/YYYY-MM-DD?json`.

The official API defines `portdate` as information for a particular port on a particular date. For port summaries it defines `records` as total records for the date, `targets` as unique destination IPs, and `sources` as unique originating IPs. The application normalizes only `records`; the other aggregate fields are retained only as a sanitized audit snapshot.

Important interpretation limits:
- `records` is submitted observation/report volume, **not** unique attackers and not confirmed compromises.
- DShield is a contributed-sensor system, so sensor population and reporting behavior can affect totals.
- The API is explicitly best-effort and can return HTTP 429 under load. The app reuses an already-preserved completed source day, honors `Retry-After`, and backs off after failures.
- The API currently does not require authentication, but SANS asks automated clients to use a custom User-Agent with contact information. The app defaults that contact field to this public GitHub repository, while `UPSTREAM_CONTACT_URL` can override it for another public project URL.
- `portdate` exposes a source date rather than a second-level observation instant. The app canonicalizes the source day to UTC day-start for the receipt field and separately declares/displays `source_observed_precision=day`.

Attribution shown in the app: SANS Internet Storm Center / DShield.
