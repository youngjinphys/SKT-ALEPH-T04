export const NORMALIZED_KEYS = Object.freeze([
  'signal_id', 'normalized_value', 'unit', 'source_name', 'source_url',
  'source_time', 'fetched_at', 'record_timezone', 'record_date'
]);

export const ERROR_CODES = Object.freeze([
  'timeout', 'auth', 'rate_limit', 'offline', 'schema_error'
]);

export function kstDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) throw new TypeError('invalid ISO date-time');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function mostRecentCompletedUtcDate(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('invalid now');
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function isDateTimeString(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    && !Number.isNaN(new Date(value).getTime());
}

export function validateNormalizedReading(reading) {
  if (!reading || typeof reading !== 'object' || Array.isArray(reading)) throw new TypeError('reading must be object');
  const actual = Object.keys(reading).sort();
  const expected = [...NORMALIZED_KEYS].sort();
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) {
    throw new TypeError(`reading keys must exactly match ${NORMALIZED_KEYS.join(', ')}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(reading.signal_id) || reading.signal_id.length > 100) throw new TypeError('invalid signal_id');
  if (typeof reading.normalized_value !== 'number' || !Number.isFinite(reading.normalized_value)) throw new TypeError('invalid normalized_value');
  if (typeof reading.unit !== 'string' || !reading.unit.trim() || reading.unit.length > 24) throw new TypeError('invalid unit');
  if (typeof reading.source_name !== 'string' || !reading.source_name.trim() || reading.source_name.length > 120) throw new TypeError('invalid source_name');
  if (typeof reading.source_url !== 'string') throw new TypeError('invalid source_url');
  const u = new URL(reading.source_url);
  if (u.protocol !== 'https:') throw new TypeError('source_url must use HTTPS');
  if (reading.source_time !== null && !isDateTimeString(reading.source_time)) throw new TypeError('invalid source_time');
  if (!isDateTimeString(reading.fetched_at)) throw new TypeError('invalid fetched_at');
  if (reading.record_timezone !== 'Asia/Seoul') throw new TypeError('record_timezone must be Asia/Seoul');
  if (typeof reading.record_date !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(reading.record_date)) throw new TypeError('invalid record_date');
  if (reading.record_date !== kstDate(reading.fetched_at)) throw new TypeError('record_date mismatch');
  return true;
}

export function validateStatus(status) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return false;
  if (status.freshness === 'fresh') return status.error_code === 'none';
  return status.freshness === 'stale' && ERROR_CODES.includes(status.error_code);
}

export function emptyState(kind = 'live') {
  return {
    schema_version: 'aleph-t04-state-v1',
    kind,
    daily_readings: [],
    current_reading: null,
    current_meta: null,
    status: null,
    last_comparison: { state: 'insufficient', signed: null, magnitude: null, direction: null, unit: null },
    last_run: null,
    sequence: 0
  };
}

export function recordIdFor(reading) {
  return `${reading.signal_id}:${reading.record_date}`;
}

export function comparisonFor(rows, currentRow) {
  const previous = rows
    .filter((row) => row.signal_id === currentRow.signal_id && row.record_date < currentRow.record_date)
    .sort((a, b) => b.record_date.localeCompare(a.record_date))[0];
  if (!previous) return { state: 'insufficient', signed: null, magnitude: null, direction: null, unit: null };
  if (previous.unit !== currentRow.unit) return { state: 'unit_mismatch', signed: null, magnitude: null, direction: null, unit: null };
  const signed = currentRow.normalized_value - previous.normalized_value;
  return {
    state: 'comparable', signed, magnitude: Math.abs(signed),
    direction: signed > 0 ? 'increase' : signed < 0 ? 'decrease' : 'unchanged', unit: currentRow.unit
  };
}

export function applySuccessfulReading(input, reading, meta = {}) {
  validateNormalizedReading(reading);
  const state = structuredClone(input);
  const idx = state.daily_readings.findIndex((r) => r.signal_id === reading.signal_id && r.record_date === reading.record_date);
  const existing = idx >= 0 ? state.daily_readings[idx] : null;
  const row = {
    record_id: existing?.record_id ?? recordIdFor(reading),
    signal_id: reading.signal_id,
    record_date: reading.record_date,
    normalized_value: reading.normalized_value,
    unit: reading.unit,
    first_fetched_at: existing?.first_fetched_at ?? reading.fetched_at,
    last_fetched_at: reading.fetched_at,
    source_observed_at: meta.source_observed_at ?? reading.source_time,
    source_observed_precision: meta.source_observed_precision ?? (reading.source_time ? 'instant' : 'unknown'),
    source_period: meta.source_period ?? null,
    raw_sha256: meta.raw_sha256 ?? null,
    raw_aggregate: meta.raw_aggregate ?? null,
    reading: structuredClone(reading)
  };
  if (idx >= 0) state.daily_readings[idx] = row; else state.daily_readings.push(row);
  state.daily_readings.sort((a, b) => a.record_date.localeCompare(b.record_date));
  state.current_reading = structuredClone(reading);
  state.current_meta = {
    source_observed_at: row.source_observed_at,
    source_observed_precision: row.source_observed_precision,
    source_period: row.source_period,
    raw_sha256: row.raw_sha256,
    raw_aggregate: row.raw_aggregate,
    cache_hit: Boolean(meta.cache_hit)
  };
  state.status = { freshness: 'fresh', error_code: 'none' };
  state.last_comparison = comparisonFor(state.daily_readings, row);
  state.sequence += 1;
  state.last_run = {
    outcome: 'success', error_code: 'none',
    fixture_id: meta.fixture_id ?? null,
    attempted_at: meta.attempted_at ?? reading.fetched_at,
    upstream_status: meta.upstream_status ?? 200,
    retry_after_seconds: null,
    cache_hit: Boolean(meta.cache_hit)
  };
  return state;
}

export function applyError(input, errorCode, meta = {}) {
  if (!ERROR_CODES.includes(errorCode)) throw new TypeError(`unsupported error_code ${errorCode}`);
  const state = structuredClone(input);
  state.status = { freshness: 'stale', error_code: errorCode };
  state.sequence += 1;
  state.last_run = {
    outcome: 'error', error_code: errorCode,
    fixture_id: meta.fixture_id ?? null,
    attempted_at: meta.attempted_at ?? new Date().toISOString(),
    upstream_status: meta.upstream_status ?? null,
    retry_after_seconds: meta.retry_after_seconds ?? null,
    cache_hit: false
  };
  return state;
}
