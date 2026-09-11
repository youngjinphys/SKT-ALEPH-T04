import crypto from 'node:crypto';
import { kstDate, mostRecentCompletedUtcDate, validateNormalizedReading } from './domain.mjs';

export const SIGNAL = Object.freeze({
  id: 'dshield.port22.reports.completed_utc_day',
  name: 'Global port 22 submitted report volume',
  unit: 'reports',
  sourceName: 'SANS Internet Storm Center / DShield'
});

function asFiniteNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const text = v.trim();
    if (!text) return null;
    if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
    const n = Number(text.replaceAll(',', ''));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v !== 'number') return null;
  return Number.isFinite(v) ? v : null;
}

function candidates(payload) {
  const root = payload?.portdate && typeof payload.portdate === 'object' ? payload.portdate : payload;
  const found = [];
  const rootPort = asFiniteNumber(root?.number ?? root?.port ?? root?.portin);
  const visit = (x, depth = 0) => {
    if (!x || typeof x !== 'object' || depth > 5) return;
    if (!Array.isArray(x) && ('date' in x || 'datein' in x) && 'records' in x) {
      const rowPort = asFiniteNumber(x.portin ?? x.port ?? rootPort);
      found.push({ row: x, port: rowPort });
    }
    if (Array.isArray(x)) for (const y of x) visit(y, depth + 1);
    else for (const y of Object.values(x)) visit(y, depth + 1);
  };
  visit(root);
  return found;
}

export function parsePortDateJson(payload, requestedDate, expectedPort = 22) {
  const candidate = candidates(payload).find(({ row }) => String(row.date ?? row.datein).trim() === requestedDate);
  if (!candidate) throw new TypeError('DShield schema changed: date/records row not found');
  if (candidate.port !== null && candidate.port !== expectedPort) throw new TypeError('DShield schema changed: returned port does not match request');
  const row = candidate.row;
  const records = asFiniteNumber(row.records);
  if (records === null || records < 0 || !Number.isSafeInteger(records)) throw new TypeError('DShield schema changed: records is not a non-negative safe integer');
  return {
    source_date: requestedDate,
    records,
    targets: asFiniteNumber(row.targets),
    sources: asFiniteNumber(row.sources),
    tcp: asFiniteNumber(row.tcp),
    udp: asFiniteNumber(row.udp)
  };
}

export function sourceUrlFor(date) {
  return `https://isc.sans.edu/api/portdate/22/${date}?json`;
}

function parseRetryAfter(value, now) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

function timeoutError() {
  const error = new Error('upstream deadline exceeded');
  error.name = 'TimeoutError';
  return error;
}

async function withinDeadline(promise, deadlineAt, controller) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) { controller.abort(); throw timeoutError(); }
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(timeoutError()); }, remaining);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLiveReading({ now = new Date(), timeoutMs = 4500, maxBodyBytes = 256 * 1024 } = {}) {
  const sourceDate = mostRecentCompletedUtcDate(now);
  const url = sourceUrlFor(sourceDate);
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  let res;
  try {
    res = await withinDeadline(fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': `ALEPH-T04-Security-Pulse/1.1 (educational; aggregate-only; contact=${process.env.UPSTREAM_CONTACT_URL || 'https://github.com/youngjinphys/SKT-ALEPH-T04'})`
      },
      signal: controller.signal,
      cache: 'no-store'
    }), deadlineAt, controller);
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return { ok: false, error_code: 'timeout', status: null, retry_after_seconds: null };
    return { ok: false, error_code: 'offline', status: null, retry_after_seconds: null };
  }

  if (res.status === 401 || res.status === 403) return { ok: false, error_code: 'auth', status: res.status, retry_after_seconds: null };
  if (res.status === 429) {
    return { ok: false, error_code: 'rate_limit', status: 429, retry_after_seconds: parseRetryAfter(res.headers.get('retry-after'), now) };
  }
  if (!res.ok) return { ok: false, error_code: res.status >= 500 ? 'offline' : 'schema_error', status: res.status, retry_after_seconds: null };

  let rawText;
  let payload;
  try {
    const declaredLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) throw new TypeError('upstream response too large');
    rawText = await withinDeadline(res.text(), deadlineAt, controller);
    if (Buffer.byteLength(rawText, 'utf8') > maxBodyBytes) throw new TypeError('upstream response too large');
    payload = JSON.parse(rawText);
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return { ok: false, error_code: 'timeout', status: res.status, retry_after_seconds: null };
    return { ok: false, error_code: 'schema_error', status: res.status, retry_after_seconds: null };
  }

  try {
    const parsed = parsePortDateJson(payload, sourceDate);
    const fetchedAt = now.toISOString();
    // DShield portdate exposes day precision, not an exact observation instant.
    // Canonicalize to the start of that UTC day and preserve precision='day' in metadata.
    const sourceObservedAt = `${sourceDate}T00:00:00.000Z`;
    const reading = {
      signal_id: SIGNAL.id,
      normalized_value: parsed.records,
      unit: SIGNAL.unit,
      source_name: SIGNAL.sourceName,
      source_url: url,
      source_time: sourceObservedAt,
      fetched_at: fetchedAt,
      record_timezone: 'Asia/Seoul',
      record_date: kstDate(fetchedAt)
    };
    validateNormalizedReading(reading);
    return {
      ok: true,
      reading,
      meta: {
        source_observed_at: sourceObservedAt,
        source_observed_precision: 'day',
        source_period: `${sourceDate} UTC (00:00–23:59)`,
        raw_aggregate: parsed,
        raw_sha256: crypto.createHash('sha256').update(rawText).digest('hex'),
        upstream_status: res.status,
        aggregate: parsed
      }
    };
  } catch {
    return { ok: false, error_code: 'schema_error', status: res.status, retry_after_seconds: null };
  }
}
