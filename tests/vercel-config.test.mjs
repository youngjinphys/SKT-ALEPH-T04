import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('Vercel exposes one serverless router and keeps API paths same-origin',async()=>{
  const config=JSON.parse(await fs.readFile(path.join(root,'vercel.json'),'utf8'));
  assert.equal(config.framework,null);
  assert.ok(config.functions['api/router.mjs'].includeFiles.includes('contract/fixtures'));
  const sources=config.rewrites.map(x=>x.source);
  for(const required of ['/api/status','/api/evidence','/api/live/refresh','/api/replay/:match*'])assert.ok(sources.includes(required));
  assert.match(JSON.stringify(config.headers),/Content-Security-Policy/);
});

test('Supabase migration exposes only one canonical live state key',async()=>{
  const sql=await fs.readFile(path.join(root,'supabase/migrations/202609120001_t04_live_state.sql'),'utf8');
  assert.match(sql,/state_key\s*=\s*'live'/);
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/revoke all on table public\.t04_state from anon, authenticated/i);
  assert.match(sql,/grant select, insert, update on table public\.t04_state to service_role/i);
});
