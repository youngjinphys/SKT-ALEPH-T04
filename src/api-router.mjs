import { emptyState } from './domain.mjs';
import { evidencePreview, publicState, refreshLiveState } from './live-service.mjs';
import { runFixture } from './replay.mjs';

const SOURCE_STRATEGY = Object.freeze({ signal: 'DShield TCP/22 reports', window: 'most recent completed UTC day', record_timezone: 'Asia/Seoul' });
const MAX_REPLAY_HISTORY = 16;
const REPLAY_COOKIE = 't04_replay';

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders }
  });
}

function isCrossSiteMutation(request) {
  if (request.method !== 'POST') return false;
  if (String(request.headers.get('sec-fetch-site') || '').toLowerCase() === 'cross-site') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host !== new URL(request.url).host; } catch { return true; }
}

function replaySessionKey(url, field = 'session') {
  const raw = url.searchParams.get(field) || url.searchParams.get(field === 'session' ? 'replay_session' : 'session');
  if (!raw) return 'default';
  return /^[a-f0-9-]{36}$/i.test(raw) ? raw.toLowerCase() : 'default';
}

function cookieMap(header) {
  const out = new Map();
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    out.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return out;
}

function decodeReplayCookie(request, session, fixtures) {
  const encoded = cookieMap(request.headers.get('cookie')).get(REPLAY_COOKIE);
  if (!encoded) return [];
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload?.session !== session || !Array.isArray(payload?.history)) return [];
    if (payload.history.length > MAX_REPLAY_HISTORY) return [];
    if (payload.history.some((id) => typeof id !== 'string' || !fixtures.has(id))) return [];
    return payload.history;
  } catch { return []; }
}

function replayCookie(session, history) {
  const payload = Buffer.from(JSON.stringify({ session, history: history.slice(-MAX_REPLAY_HISTORY) }), 'utf8').toString('base64url');
  return `${REPLAY_COOKIE}=${payload}; Path=/; Max-Age=7200; HttpOnly; Secure; SameSite=Strict`;
}

function replayFromHistory(history, fixtures) {
  let state = emptyState('replay');
  for (const id of history) state = runFixture(state, fixtures.get(id));
  return state;
}

export function createApiRouter({ liveRepo, fixtures, fetchReading, now = () => new Date() }) {
  if (!liveRepo || !fixtures) throw new TypeError('liveRepo and fixtures are required');
  return async function route(request) {
    try {
      if (isCrossSiteMutation(request)) return json(403, { error: 'cross_site_post_blocked' });
      const url = new URL(request.url);
      const p = String(url.searchParams.get('path') || '').replace(/^\/+|\/+$/g, '');

      if (request.method === 'GET' && p === 'status') {
        const session = replaySessionKey(url, 'replay_session');
        const history = decodeReplayCookie(request, session, fixtures);
        const [live, replay] = await Promise.all([liveRepo.read(), Promise.resolve(replayFromHistory(history, fixtures))]);
        return json(200, { live: publicState(live), replay: publicState(replay), source_strategy: SOURCE_STRATEGY, storage: 'supabase' });
      }
      if (request.method === 'GET' && p === 'evidence') return json(200, evidencePreview(await liveRepo.read()));
      if (request.method === 'POST' && p === 'live/refresh') {
        const result = await refreshLiveState({ repo: liveRepo, now: now(), fetchReading });
        return json(result.status, result.body);
      }
      if (request.method === 'POST' && p === 'replay/reset') {
        const session = replaySessionKey(url);
        return json(200, { state: publicState(emptyState('replay')) }, { 'set-cookie': replayCookie(session, []) });
      }
      if (request.method === 'POST' && p.startsWith('replay/')) {
        const fixtureId = decodeURIComponent(p.slice('replay/'.length));
        if (!fixtures.has(fixtureId)) return json(404, { error: 'fixture_not_found' });
        const session = replaySessionKey(url);
        const history = decodeReplayCookie(request, session, fixtures);
        const nextHistory = [...history, fixtureId].slice(-MAX_REPLAY_HISTORY);
        const state = replayFromHistory(nextHistory, fixtures);
        return json(200, { state: publicState(state), fixture_id: fixtureId }, { 'set-cookie': replayCookie(session, nextHistory) });
      }
      if (!['GET','POST'].includes(request.method)) return json(405, { error: 'method_not_allowed' });
      return json(404, { error: 'not_found' });
    } catch (error) {
      console.error(error);
      return json(500, { error: error?.code || 'internal_error' });
    }
  };
}
