import { emptyState } from './domain.mjs';

export class StorageConfigurationError extends Error {
  constructor(message = 'Supabase storage is not configured') {
    super(message);
    this.name = 'StorageConfigurationError';
    this.code = 'storage_unconfigured';
  }
}

export function supabaseConfigFromEnv(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new StorageConfigurationError('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  let parsed;
  try { parsed = new URL(url); } catch { throw new StorageConfigurationError('SUPABASE_URL must be an absolute URL'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) {
    throw new StorageConfigurationError('SUPABASE_URL must use HTTPS on a supabase.co project host');
  }
  return { url, key };
}

function encodeFilterValue(value) {
  return String(value).replaceAll('"', '\\"');
}

export class SupabaseStateRepository {
  constructor({ url, key, stateKey = 'live', kind = 'live', fetchFn = globalThis.fetch, maxRetries = 4 }) {
    if (!url || !key) throw new StorageConfigurationError();
    if (stateKey !== 'live') throw new TypeError('this repository is intentionally restricted to the single live state row');
    if (typeof fetchFn !== 'function') throw new TypeError('fetchFn must be a function');
    this.url = url.replace(/\/$/, '');
    this.key = key;
    this.stateKey = stateKey;
    this.kind = kind;
    this.fetchFn = fetchFn;
    this.maxRetries = maxRetries;
  }

  static fromEnv(env = process.env, options = {}) {
    return new SupabaseStateRepository({ ...supabaseConfigFromEnv(env), ...options });
  }

  headers(prefer = null) {
    const headers = {
      apikey: this.key,
      authorization: `Bearer ${this.key}`,
      'content-type': 'application/json',
      accept: 'application/json'
    };
    if (prefer) headers.prefer = prefer;
    return headers;
  }

  endpoint(params = {}) {
    const url = new URL(`${this.url}/rest/v1/t04_state`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  }

  async request(url, init) {
    const res = await this.fetchFn(url, init);
    if (res.ok) return res;
    let detail = '';
    try {
      const payload = await res.json();
      detail = payload?.message || payload?.hint || payload?.code || '';
    } catch {}
    const error = new Error(`Supabase storage request failed with HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    error.code = 'storage_error';
    error.status = res.status;
    throw error;
  }

  async readVersioned() {
    const res = await this.request(this.endpoint({
      state_key: `eq.${encodeFilterValue(this.stateKey)}`,
      select: 'state,version',
      limit: '1'
    }), { method: 'GET', headers: this.headers(), cache: 'no-store' });
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return { exists: false, state: emptyState(this.kind), version: 0 };
    const row = rows[0];
    if (!row || typeof row.state !== 'object' || !Number.isSafeInteger(Number(row.version))) {
      const error = new Error('Supabase storage returned an invalid state row');
      error.code = 'storage_schema_error';
      throw error;
    }
    return { exists: true, state: row.state, version: Number(row.version) };
  }

  async read() {
    return (await this.readVersioned()).state;
  }

  async insertIfMissing(state) {
    const res = await this.request(this.endpoint({ on_conflict: 'state_key', select: 'state,version' }), {
      method: 'POST',
      headers: this.headers('resolution=ignore-duplicates,return=representation'),
      body: JSON.stringify([{ state_key: this.stateKey, state, version: 1 }])
    });
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  }

  async compareAndSwap(expectedVersion, state) {
    const res = await this.request(this.endpoint({
      state_key: `eq.${encodeFilterValue(this.stateKey)}`,
      version: `eq.${expectedVersion}`,
      select: 'state,version'
    }), {
      method: 'PATCH',
      headers: this.headers('return=representation'),
      body: JSON.stringify({ state, version: expectedVersion + 1, updated_at: new Date().toISOString() })
    });
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  }

  async write(state) {
    return this.transact(() => state);
  }

  async transact(mutator) {
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      const current = await this.readVersioned();
      const next = await mutator(structuredClone(current.state));
      if (!next || typeof next !== 'object' || Array.isArray(next)) throw new TypeError('state mutator must return an object');
      if (!current.exists) {
        if (await this.insertIfMissing(next)) return next;
        continue;
      }
      if (await this.compareAndSwap(current.version, next)) return next;
    }
    const error = new Error('Supabase state update conflicted repeatedly; retry the request');
    error.code = 'storage_conflict';
    throw error;
  }
}
