import fs from 'node:fs/promises';
import path from 'node:path';
import { applyError, applySuccessfulReading } from './domain.mjs';

export async function loadFixtures(dir) {
  const files = await fs.readdir(dir);
  const out = new Map();
  for (const name of files.filter((n) => n.endsWith('.json'))) {
    const fixture = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
    out.set(fixture.fixture_id, fixture);
  }
  return out;
}

export function runFixture(state, fixture) {
  const attempted_at = fixture.virtual_now;
  const meta = {
    fixture_id: fixture.fixture_id,
    attempted_at,
    upstream_status: fixture.transport.status,
    retry_after_seconds: fixture.transport.headers?.['retry-after'] ? Number(fixture.transport.headers['retry-after']) : null
  };
  if (fixture.transport.mode === 'timeout') return applyError(state, 'timeout', meta);
  if (fixture.transport.mode === 'offline') return applyError(state, 'offline', meta);
  if ([401, 403].includes(fixture.transport.status)) return applyError(state, 'auth', meta);
  if (fixture.transport.status === 429) return applyError(state, 'rate_limit', meta);
  if (fixture.transport.status >= 200 && fixture.transport.status < 300) {
    try {
      return applySuccessfulReading(state, fixture.payload, {
        ...meta,
        source_observed_at: fixture.payload.source_time,
        source_observed_precision: fixture.payload.source_time ? 'instant' : 'unknown',
        source_period: fixture.payload.source_time ? null : 'Upstream fixture omitted exact source time'
      });
    } catch {
      return applyError(state, 'schema_error', meta);
    }
  }
  return applyError(state, 'schema_error', meta);
}
