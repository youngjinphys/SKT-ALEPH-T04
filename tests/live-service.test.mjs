import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applySuccessfulReading } from '../src/domain.mjs';
import { refreshLiveState, evidencePreview } from '../src/live-service.mjs';

class MemoryRepo{constructor(state=emptyState('live')){this.state=state;}async read(){return structuredClone(this.state)}async transact(fn){this.state=await fn(structuredClone(this.state));return structuredClone(this.state)}}
function reading(sourceDate,value,fetchedAt){return{signal_id:'dshield.port22.reports.completed_utc_day',normalized_value:value,unit:'reports',source_name:'SANS Internet Storm Center / DShield',source_url:`https://isc.sans.edu/api/portdate/22/${sourceDate}?json`,source_time:`${sourceDate}T00:00:00.000Z`,fetched_at:fetchedAt,record_timezone:'Asia/Seoul',record_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(fetchedAt))};}
function seedTwo(){let s=emptyState('live');for(const [src,val,at] of [['2026-09-10',900,'2026-09-11T01:00:00.000Z'],['2026-09-11',975,'2026-09-12T01:00:00.000Z']])s=applySuccessfulReading(s,reading(src,val,at),{source_observed_at:`${src}T00:00:00.000Z`,source_observed_precision:'day',source_period:`${src} UTC (00:00–23:59)`,raw_sha256:'a'.repeat(64)});return s;}

test('after two actual KST dates the live capture is locked and upstream is not called',async()=>{
  const repo=new MemoryRepo(seedTwo());let calls=0;
  const result=await refreshLiveState({repo,now:new Date('2026-09-13T01:00:00.000Z'),fetchReading:async()=>{calls++;throw new Error('must not fetch')}});
  assert.equal(result.status,200);assert.equal(result.body.capture_complete,true);assert.equal(result.body.state.daily_readings.length,2);assert.equal(calls,0);
});

test('first live capture stores a successful reading and marks capture incomplete',async()=>{
  const repo=new MemoryRepo();
  const r=reading('2026-09-10',900,'2026-09-11T01:00:00.000Z');
  const result=await refreshLiveState({repo,now:new Date('2026-09-11T01:00:00.000Z'),fetchReading:async()=>({ok:true,reading:r,meta:{source_observed_at:r.source_time,source_observed_precision:'day',source_period:'2026-09-10 UTC (00:00–23:59)',raw_sha256:'a'.repeat(64)}})});
  assert.equal(result.body.upstream_fetch,true);assert.equal(result.body.capture_complete,false);assert.equal(result.body.state.daily_readings.length,1);
});

test('evidence preview never emits more than the two required live days',()=>{
  const preview=evidencePreview(seedTwo());assert.equal(preview.count,2);assert.deepEqual(preview.receipts_preview.map(x=>x.payload.normalized_value),[900,975]);
});
