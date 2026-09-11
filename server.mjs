import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyError, applySuccessfulReading, emptyState, validateStatus, mostRecentCompletedUtcDate } from './src/domain.mjs';
import { fetchLiveReading } from './src/dshield.mjs';
import { JsonStateRepository } from './src/repository.mjs';
import { loadFixtures, runFixture } from './src/replay.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const fixtureDir = path.join(__dirname, 'contract', 'fixtures');
const liveRepo = new JsonStateRepository(path.join(dataDir, 'live-state.json'), 'live');
const replayRepo = new JsonStateRepository(path.join(dataDir, 'replay-state.json'), 'replay');
const replaySessions = new Map();
const REPLAY_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const REPLAY_SESSION_MAX = 128;
const fixtures = await loadFixtures(fixtureDir);
const port = Number(process.env.PORT || 4173);

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000',
  'x-permitted-cross-domain-policies': 'none',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...securityHeaders, 'cache-control': 'no-store', 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(data);
}
function json(res, status, body) { send(res, status, body); }
function publicState(state) {
  return { ...state, status_valid: state.status === null ? null : validateStatus(state.status) };
}
function isCrossSiteMutation(req) {
  if (req.method !== 'POST') return false;
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host !== String(req.headers.host || ''); }
  catch { return true; }
}


function replaySessionKey(url, field = 'session') {
  const raw = url.searchParams.get(field) || url.searchParams.get(field === 'session' ? 'replay_session' : 'session');
  if (!raw) return 'default';
  return /^[a-f0-9-]{36}$/i.test(raw) ? raw.toLowerCase() : 'default';
}

function pruneReplaySessions(now = Date.now()) {
  for (const [key, entry] of replaySessions) {
    if (now - entry.touched_at > REPLAY_SESSION_TTL_MS) replaySessions.delete(key);
  }
  if (replaySessions.size <= REPLAY_SESSION_MAX) return;
  const oldest = [...replaySessions.entries()].sort((a, b) => a[1].touched_at - b[1].touched_at);
  for (const [key] of oldest.slice(0, replaySessions.size - REPLAY_SESSION_MAX)) replaySessions.delete(key);
}

async function readReplayState(key) {
  if (key === 'default') return replayRepo.read();
  pruneReplaySessions();
  const entry = replaySessions.get(key);
  if (!entry) return emptyState('replay');
  entry.touched_at = Date.now();
  return structuredClone(entry.state);
}

async function writeReplayState(key, state) {
  if (key === 'default') return replayRepo.write(state);
  pruneReplaySessions();
  replaySessions.set(key, { state: structuredClone(state), touched_at: Date.now() });
  pruneReplaySessions();
  return state;
}

async function transactReplayState(key, mutator) {
  if (key === 'default') return replayRepo.transact(mutator);
  const current = await readReplayState(key);
  const next = await mutator(current);
  return writeReplayState(key, next);
}

function errorMessage(code) {
  return {
    timeout: 'Upstream response exceeded the deadline.',
    auth: 'Upstream rejected the request with 401/403.',
    rate_limit: 'Upstream rate limit was reached.',
    offline: 'The upstream network request could not be completed.',
    schema_error: 'Upstream data did not match the expected aggregate schema.'
  }[code] || 'Unknown upstream error.';
}

async function liveRefresh(res) {
  const now = new Date();
  const expectedSourceDate = mostRecentCompletedUtcDate(now);
  const existing = await liveRepo.read();
  const currentSourcePeriod = existing.current_meta?.source_period || '';
  const alreadyFetched = existing.status?.freshness === 'fresh' && currentSourcePeriod.startsWith(expectedSourceDate);
  const lastRun = existing.last_run;
  if (!alreadyFetched && lastRun?.outcome === 'error' && lastRun.attempted_at) {
    const baseSeconds = lastRun.error_code === 'rate_limit' ? Math.max(300, lastRun.retry_after_seconds || 0) : 15;
    const retryAt = new Date(lastRun.attempted_at).getTime() + baseSeconds * 1000;
    if (Date.now() < retryAt) {
      return json(res, 429, {
        state: publicState(existing), error: 'local_backoff',
        retry_after_seconds: Math.ceil((retryAt - Date.now()) / 1000),
        message: 'Retry is temporarily delayed to avoid hammering the public upstream.'
      });
    }
  }
  if (alreadyFetched) {
    const cached = await liveRepo.transact((state) => {
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
    return json(res, 200, { state: publicState(cached), upstream_fetch: false, note: 'Completed UTC source day already preserved; served cached aggregate to avoid unnecessary upstream traffic.' });
  }

  const result = await fetchLiveReading({ now });
  if (!result.ok) {
    const failed = await liveRepo.transact((state) => applyError(state, result.error_code, {
      attempted_at: now.toISOString(), upstream_status: result.status, retry_after_seconds: result.retry_after_seconds
    }));
    return json(res, 502, { state: publicState(failed), error: result.error_code, message: errorMessage(result.error_code) });
  }
  const next = await liveRepo.transact((state) => applySuccessfulReading(state, result.reading, result.meta));
  return json(res, 200, { state: publicState(next), upstream_fetch: true });
}

async function serveStatic(req, res, pathname) {
  const map = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(map).replace(/^([.][.][/\\])+/, '');
  const file = path.join(publicDir, safe);
  if (!file.startsWith(publicDir)) return false;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    const ext = path.extname(file);
    const type = ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'})[ext] || 'application/octet-stream';
    const data = await fs.readFile(file);
    res.writeHead(200, { ...securityHeaders, 'content-type': type, 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
    res.end(data);
    return true;
  } catch { return false; }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      if (isCrossSiteMutation(req)) return json(res, 403, { error: 'cross_site_post_blocked' });
      if (req.method === 'GET' && p === '/api/status') {
        const replayKey = replaySessionKey(url, 'replay_session');
        const [live, replay] = await Promise.all([liveRepo.read(), readReplayState(replayKey)]);
        return json(res, 200, { live: publicState(live), replay: publicState(replay), source_strategy: { signal: 'DShield TCP/22 reports', window: 'most recent completed UTC day', record_timezone: 'Asia/Seoul' } });
      }
      if (req.method === 'POST' && p === '/api/live/refresh') return await liveRefresh(res);
      if (req.method === 'POST' && p === '/api/replay/reset') {
        const replayKey = replaySessionKey(url);
        return json(res, 200, { state: publicState(await writeReplayState(replayKey, emptyState('replay'))) });
      }
      if (req.method === 'POST' && p.startsWith('/api/replay/')) {
        const fixtureId = decodeURIComponent(p.slice('/api/replay/'.length));
        const fixture = fixtures.get(fixtureId);
        if (!fixture) return json(res, 404, { error: 'fixture_not_found' });
        const replayKey = replaySessionKey(url);
        const state = await transactReplayState(replayKey, (s) => runFixture(s, fixture));
        return json(res, 200, { state: publicState(state), fixture_id: fixtureId });
      }
      if (req.method === 'GET' && p === '/api/evidence') {
        const state = await liveRepo.read();
        const rows = state.daily_readings.slice(-2).map((row) => ({
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
        return json(res, 200, { count: rows.length, receipts_preview: rows, note: 'Preview only. Use the course platform sealed receipts as the canonical submission evidence.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' });
      if (await serveStatic(req, res, p)) return;
      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      console.error(error);
      return json(res, 500, { error: 'internal_error' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(port, '0.0.0.0', () => console.log(`Security Pulse Board listening on http://0.0.0.0:${port}`));
}
