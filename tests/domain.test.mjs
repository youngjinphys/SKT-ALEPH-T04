import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { emptyState, applySuccessfulReading, applyError, kstDate, mostRecentCompletedUtcDate, validateNormalizedReading } from '../src/domain.mjs';
import { loadFixtures, runFixture } from '../src/replay.mjs';
import { parsePortDateJson } from '../src/dshield.mjs';

const fixtureDir = new URL('../contract/fixtures/', import.meta.url).pathname;
const fixtures = await loadFixtures(fixtureDir);

test('KST date boundary is derived from fetched_at',()=>{
  assert.equal(kstDate('2026-09-11T14:59:59Z'),'2026-09-11');
  assert.equal(kstDate('2026-09-11T15:00:00Z'),'2026-09-12');
});
test('completed UTC day uses yesterday UTC',()=>{
  assert.equal(mostRecentCompletedUtcDate(new Date('2026-09-11T07:00:00Z')),'2026-09-10');
});
test('same synthetic date atomically updates one row and preserves record id',()=>{
  let s=emptyState('replay');
  s=runFixture(s,fixtures.get('T04-NORMAL-D1-A')); const id=s.daily_readings[0].record_id;
  s=runFixture(s,fixtures.get('T04-NORMAL-D1-B'));
  assert.equal(s.daily_readings.length,1);assert.equal(s.daily_readings[0].record_id,id);assert.equal(s.current_reading.normalized_value,105);
});
test('next synthetic date adds one row and delta is +15',()=>{
  let s=emptyState('replay');
  for(const id of ['T04-NORMAL-D1-A','T04-NORMAL-D1-B','T04-NORMAL-D2'])s=runFixture(s,fixtures.get(id));
  assert.equal(s.daily_readings.length,2);assert.equal(s.last_comparison.signed,15);assert.equal(s.status.freshness,'fresh');
});
for(const [id,code] of [['T04-TIMEOUT','timeout'],['T04-AUTH-401','auth'],['T04-RATE-429','rate_limit'],['T04-OFFLINE','offline'],['T04-SCHEMA-BREAK','schema_error']]){
  test(`${id} retains last good value and marks stale/${code}`,()=>{
    let s=emptyState('replay');s=runFixture(s,fixtures.get('T04-NORMAL-D1-A'));s=runFixture(s,fixtures.get('T04-NORMAL-D1-B'));s=runFixture(s,fixtures.get(id));
    assert.equal(s.daily_readings.length,1);assert.equal(s.current_reading.normalized_value,105);assert.deepEqual(s.status,{freshness:'stale',error_code:code});
  });
}
test('recovery adds exactly one next-day row and returns fresh/none',()=>{
  let s=emptyState('replay');for(const id of ['T04-NORMAL-D1-A','T04-NORMAL-D1-B','T04-TIMEOUT','T04-RECOVER-D2'])s=runFixture(s,fixtures.get(id));
  assert.equal(s.daily_readings.length,2);assert.deepEqual(s.status,{freshness:'fresh',error_code:'none'});assert.equal(s.current_reading.normalized_value,120);
});
test('DShield parser tolerates nested JSON shapes but requires requested date',()=>{
  const x=parsePortDateJson({portdate:{data:{date:'2026-09-10',records:'123,456',targets:'42',sources:7}}},'2026-09-10');
  assert.equal(x.records,123456);assert.equal(x.targets,42);assert.throws(()=>parsePortDateJson({data:{date:'2026-09-09',records:1}},'2026-09-10'));
  assert.throws(()=>parsePortDateJson({data:{date:'2026-09-10',records:'1,2'}},'2026-09-10'),/records/);
});


test('normalized reading validator enforces contract date-time string types instead of Date coercion',()=>{
  const base={
    signal_id:'x.signal',normalized_value:1,unit:'pt',source_name:'public source',
    source_url:'https://example.org/value',source_time:'2026-09-10T23:59:00.000Z',
    fetched_at:'2026-09-11T00:00:00.000Z',record_timezone:'Asia/Seoul',record_date:'2026-09-11'
  };
  assert.equal(validateNormalizedReading(base),true);
  assert.throws(()=>validateNormalizedReading({...base,source_time:0}),/source_time/);
  assert.throws(()=>validateNormalizedReading({...base,fetched_at:0,record_date:'1970-01-01'}),/fetched_at/);
  assert.throws(()=>validateNormalizedReading({...base,fetched_at:'2026-09-11',record_date:'2026-09-11'}),/fetched_at/);
});
