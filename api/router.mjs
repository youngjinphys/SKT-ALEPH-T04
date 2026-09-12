import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiRouter } from '../src/api-router.mjs';
import { loadFixtures } from '../src/replay.mjs';
import { StorageConfigurationError, SupabaseStateRepository } from '../src/supabase-repository.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturesPromise = loadFixtures(path.join(root, 'contract', 'fixtures'));

function unavailable(error) {
  return new Response(JSON.stringify({
    error: error?.code || 'storage_unconfigured',
    message: 'Persistent live storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY on the server.'
  }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function dispatch(request) {
  try {
    const [fixtures, liveRepo] = await Promise.all([
      fixturesPromise,
      Promise.resolve(SupabaseStateRepository.fromEnv(process.env, { stateKey: 'live', kind: 'live' }))
    ]);
    return createApiRouter({ liveRepo, fixtures })(request);
  } catch (error) {
    if (error instanceof StorageConfigurationError || error?.code === 'storage_unconfigured') return unavailable(error);
    console.error(error);
    return new Response(JSON.stringify({ error: 'api_initialization_failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
}

export function GET(request) { return dispatch(request); }
export function POST(request) { return dispatch(request); }
