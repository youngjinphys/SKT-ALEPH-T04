import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(),'t04-server-'));
process.env.DATA_DIR=temp;
const { createServer } = await import('../server.mjs');
const { emptyState, applySuccessfulReading } = await import('../src/domain.mjs');
let server,base;
test.before(async()=>{server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`});
test.after(()=>new Promise(r=>server.close(r)));

test('public dashboard and state API require no authentication',async()=>{
  let r=await fetch(base+'/');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/default-src 'self'/);assert.match(await r.text(),/SECURITY PULSE/);
  r=await fetch(base+'/api/status');assert.equal(r.status,200);const j=await r.json();assert.equal(j.live.daily_readings.length,0);
});
test('fixture replay is isolated and deterministic',async()=>{
  await fetch(base+'/api/replay/reset',{method:'POST'});
  for(const id of ['T04-NORMAL-D1-A','T04-NORMAL-D1-B','T04-TIMEOUT'])await fetch(base+'/api/replay/'+id,{method:'POST'});
  const j=await (await fetch(base+'/api/status')).json();assert.equal(j.replay.current_reading.normalized_value,105);assert.deepEqual(j.replay.status,{freshness:'stale',error_code:'timeout'});assert.equal(j.live.daily_readings.length,0);
});
test('evidence preview is public but empty before live receipts',async()=>{
  const r=await fetch(base+'/api/evidence');
  assert.equal(r.status,200);
  const j=await r.json();
  assert.equal(j.count,0);
  assert.deepEqual(j.receipts_preview,[]);
});

test('cross-site POST mutation is rejected without introducing login',async()=>{
  const r=await fetch(base+'/api/replay/reset',{method:'POST',headers:{origin:'https://evil.example','sec-fetch-site':'cross-site'}});
  assert.equal(r.status,403);
  assert.equal((await r.json()).error,'cross_site_post_blocked');
});

test('browser replay namespaces are isolated so public reviewers cannot overwrite each other', async()=>{
  const a='11111111-1111-4111-8111-111111111111';
  const b='22222222-2222-4222-8222-222222222222';
  await fetch(`${base}/api/replay/reset?session=${a}`,{method:'POST'});
  await fetch(`${base}/api/replay/reset?session=${b}`,{method:'POST'});
  await fetch(`${base}/api/replay/T04-NORMAL-D1-A?session=${a}`,{method:'POST'});
  await fetch(`${base}/api/replay/T04-NORMAL-D1-B?session=${a}`,{method:'POST'});
  await fetch(`${base}/api/replay/T04-NORMAL-D1-A?session=${b}`,{method:'POST'});
  const sa=await (await fetch(`${base}/api/status?replay_session=${a}`)).json();
  const sb=await (await fetch(`${base}/api/status?replay_session=${b}`)).json();
  assert.equal(sa.replay.current_reading.normalized_value,105);
  assert.equal(sb.replay.current_reading.normalized_value,100);
  assert.equal(sa.replay.daily_readings.length,1);
  assert.equal(sb.replay.daily_readings.length,1);
});

test('dashboard exposes per-record provenance needed to review both live receipts',async()=>{
  const html=await (await fetch(base+'/')).text();
  assert.match(html,/<th>Source observed<\/th>/);
  assert.match(html,/<th>Source URL<\/th>/);
  assert.match(html,/id="liveDetail"/);
  assert.match(html,/id="evidenceCount"/);
});


test('two preserved live days produce reviewable receipt payloads and a recomputable delta',async()=>{
  const makeReading=(date,value,fetchIso)=>({
    signal_id:'dshield.port22.reports.completed_utc_day',
    normalized_value:value,
    unit:'reports',
    source_name:'SANS Internet Storm Center / DShield',
    source_url:`https://isc.sans.edu/api/portdate/22/${date}?json`,
    source_time:`${date}T00:00:00.000Z`,
    fetched_at:fetchIso,
    record_timezone:'Asia/Seoul',
    record_date:fetchIso.slice(0,10)
  });
  let state=emptyState('live');
  state=applySuccessfulReading(state,makeReading('2026-09-10',900,'2026-09-11T01:00:00.000Z'),{
    source_observed_at:'2026-09-10T00:00:00.000Z',source_observed_precision:'day',source_period:'2026-09-10 UTC (00:00–23:59)',raw_sha256:'a'.repeat(64)
  });
  state=applySuccessfulReading(state,makeReading('2026-09-11',975,'2026-09-12T01:00:00.000Z'),{
    source_observed_at:'2026-09-11T00:00:00.000Z',source_observed_precision:'day',source_period:'2026-09-11 UTC (00:00–23:59)',raw_sha256:'b'.repeat(64)
  });
  await fs.writeFile(path.join(temp,'live-state.json'),JSON.stringify(state,null,2));

  const status=await (await fetch(base+'/api/status')).json();
  assert.equal(status.live.daily_readings.length,2);
  assert.deepEqual(status.live.last_comparison,{state:'comparable',signed:75,magnitude:75,direction:'increase',unit:'reports'});

  const evidence=await (await fetch(base+'/api/evidence')).json();
  assert.equal(evidence.count,2);
  assert.deepEqual(evidence.receipts_preview.map(x=>x.payload.normalized_value),[900,975]);
  assert.deepEqual(evidence.receipts_preview.map(x=>x.payload.unit),['reports','reports']);
  assert.deepEqual(evidence.receipts_preview.map(x=>x.payload.source_observed_at),['2026-09-10T00:00:00.000Z','2026-09-11T00:00:00.000Z']);
  assert.deepEqual(evidence.receipts_preview.map(x=>x.server_created_at),['2026-09-11T01:00:00.000Z','2026-09-12T01:00:00.000Z']);
  assert.equal(evidence.receipts_preview[1].payload.normalized_value-evidence.receipts_preview[0].payload.normalized_value,status.live.last_comparison.signed);
});
