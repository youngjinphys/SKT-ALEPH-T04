import { applyError, applySuccessfulReading, mostRecentCompletedUtcDate, validateStatus } from './domain.mjs';
import { fetchLiveReading } from './dshield.mjs';

export function publicState(state) {
  return { ...state, status_valid: state.status === null ? null : validateStatus(state.status) };
}

export function errorMessage(code) {
  return {
    timeout: 'Upstream response exceeded the deadline.',
    auth: 'Upstream rejected the request with 401/403.',
    rate_limit: 'Upstream rate limit was reached.',
    offline: 'The upstream network request could not be completed.',
    schema_error: 'Upstream data did not match the expected aggregate schema.'
  }[code] || 'Unknown upstream error.';
}

export async function refreshLiveState({ repo, now = new Date(), fetchReading = fetchLiveReading, maxLiveDays = 2 }) {
  const expectedSourceDate = mostRecentCompletedUtcDate(now);
  const existing = await repo.read();

  if ((existing.daily_readings?.length || 0) >= maxLiveDays) {
    return {
      status: 200,
      body: {
        state: publicState(existing),
        upstream_fetch: false,
        capture_complete: true,
        note: `The assignment capture is complete at ${maxLiveDays} preserved KST dates; no third live day will be stored.`
      }
    };
  }

  const currentSourcePeriod = existing.current_meta?.source_period || '';
  const alreadyFetched = existing.status?.freshness === 'fresh' && currentSourcePeriod.startsWith(expectedSourceDate);
  const lastRun = existing.last_run;
  if (!alreadyFetched && lastRun?.outcome === 'error' && lastRun.attempted_at) {
    const baseSeconds = lastRun.error_code === 'rate_limit' ? Math.max(300, lastRun.retry_after_seconds || 0) : 15;
    const retryAt = new Date(lastRun.attempted_at).getTime() + baseSeconds * 1000;
    if (now.getTime() < retryAt) {
      return {
        status: 429,
        body: {
          state: publicState(existing), error: 'local_backoff',
          retry_after_seconds: Math.ceil((retryAt - now.getTime()) / 1000),
          message: 'Retry is temporarily delayed to avoid hammering the public upstream.'
        }
      };
    }
  }

  if (alreadyFetched) {
    const cached = await repo.transact((state) => {
      if (!state.current_reading) return state;
      return applySuccessfulReading(state, state.current_reading, {
        source_observed_at: state.current_meta?.source_observed_at,
        source_observed_precision: state.current_meta?.source_observed_precision,
        source_period: state.current_meta?.source_period,
        raw_sha256: state.current_meta?.raw_sha256,
        raw_aggregate: state.current_meta?.raw_aggregate,
        cache_hit: true,
        attempted_at: now.toISOString(),
        upstream_status: 200
      });
    });
    return {
      status: 200,
      body: { state: publicState(cached), upstream_fetch: false, capture_complete: false, note: 'Completed UTC source day already preserved; served cached aggregate to avoid unnecessary upstream traffic.' }
    };
  }

  const result = await fetchReading({ now });
  if (!result.ok) {
    const failed = await repo.transact((state) => applyError(state, result.error_code, {
      attempted_at: now.toISOString(), upstream_status: result.status, retry_after_seconds: result.retry_after_seconds
    }));
    return { status: 502, body: { state: publicState(failed), error: result.error_code, message: errorMessage(result.error_code) } };
  }

  const next = await repo.transact((state) => {
    if ((state.daily_readings?.length || 0) >= maxLiveDays) return state;
    return applySuccessfulReading(state, result.reading, result.meta);
  });
  const captureComplete = (next.daily_readings?.length || 0) >= maxLiveDays;
  return { status: 200, body: { state: publicState(next), upstream_fetch: true, capture_complete: captureComplete } };
}

export function evidencePreview(state) {
  const rows = (state.daily_readings || []).slice(-2).map((row) => ({
    canonical_kind: 't04_day',
    server_created_at: row.first_fetched_at,
    payload: {
      source_url: row.reading.source_url,
      source_observed_at: row.source_observed_at,
      normalized_value: row.normalized_value,
      unit: row.unit
    },
    precision_note: row.source_observed_precision === 'day' ? 'Upstream exposes UTC day precision; source_observed_at is canonicalized to the day start.' : null,
    raw_sha256: row.raw_sha256,
    raw_aggregate: row.raw_aggregate
  }));
  return { count: rows.length, receipts_preview: rows, note: 'Preview only. Use the course platform sealed receipts as the canonical submission evidence.' };
}
