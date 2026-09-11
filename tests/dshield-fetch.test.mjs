import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLiveReading } from '../src/dshield.mjs';

const realFetch = global.fetch;
test.afterEach(()=>{ global.fetch = realFetch; });

test('live adapter normalizes DShield aggregate and preserves day precision', async()=>{
  global.fetch = async()=>new Response(JSON.stringify({portdate:{number:22,data:{date:'2026-09-10',records:'12,345',targets:'50',sources:'400',tcp:'12000',udp:'10',datein:'2026-09-10',portin:22}}}),{status:200,headers:{'content-type':'application/json'}});
  const out=await fetchLiveReading({now:new Date('2026-09-11T07:13:00Z')});
  assert.equal(out.ok,true);assert.equal(out.reading.normalized_value,12345);assert.equal(out.reading.record_date,'2026-09-11');assert.equal(out.reading.source_time,'2026-09-10T00:00:00.000Z');assert.equal(out.meta.source_observed_precision,'day');assert.equal(out.meta.raw_aggregate.sources,400);assert.match(out.meta.raw_sha256,/^[0-9a-f]{64}$/);
});
test('live adapter maps upstream 429 and Retry-After',async()=>{
  global.fetch=async()=>new Response('rate limited',{status:429,headers:{'retry-after':'420'}});
  const out=await fetchLiveReading({now:new Date('2026-09-11T07:13:00Z')});
  assert.deepEqual(out,{ok:false,error_code:'rate_limit',status:429,retry_after_seconds:420});
});
test('live adapter maps schema drift honestly',async()=>{
  global.fetch=async()=>new Response(JSON.stringify({changed:true}),{status:200});
  const out=await fetchLiveReading({now:new Date('2026-09-11T07:13:00Z')});
  assert.equal(out.ok,false);assert.equal(out.error_code,'schema_error');
});

test('live adapter rejects a portdate payload that is not explicitly for port 22', async()=>{
  global.fetch = async()=>new Response(JSON.stringify({portdate:{number:80,data:{date:'2026-09-10',records:'12345',portin:80}}}),{status:200,headers:{'content-type':'application/json'}});
  const out=await fetchLiveReading({now:new Date('2026-09-11T07:13:00Z')});
  assert.equal(out.ok,false);
  assert.equal(out.error_code,'schema_error');
});

test('live adapter rejects fractional report counts', async()=>{
  global.fetch = async()=>new Response(JSON.stringify({portdate:{number:22,data:{date:'2026-09-10',records:'12.5',portin:22}}}),{status:200,headers:{'content-type':'application/json'}});
  const out=await fetchLiveReading({now:new Date('2026-09-11T07:13:00Z')});
  assert.equal(out.ok,false);
  assert.equal(out.error_code,'schema_error');
});

test('live adapter deadline covers a slow response body, not only response headers', async()=>{
  global.fetch = async()=>({
    status:200, ok:true,
    headers:new Headers({'content-type':'application/json'}),
    text:async()=>{ await new Promise(r=>setTimeout(r,90)); return JSON.stringify({portdate:{number:22,data:{date:'2026-09-10',records:'123',portin:22}}}); }
  });
  const started=Date.now();
  const out=await fetchLiveReading({now:new Date('2026-09-11T07:13:00Z'),timeoutMs:20});
  const elapsed=Date.now()-started;
  assert.equal(out.ok,false);
  assert.equal(out.error_code,'timeout');
  assert.ok(elapsed < 80, `deadline was not enforced during body read (${elapsed}ms)`);
});

test('live adapter rejects an oversized upstream body before treating it as valid telemetry', async()=>{
  const payload={portdate:{number:22,data:{date:'2026-09-10',records:'123',portin:22}},padding:'x'.repeat(500)};
  global.fetch = async()=>new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
  const out=await fetchLiveReading({now:new Date('2026-09-11T07:13:00Z'),maxBodyBytes:128});
  assert.equal(out.ok,false);
  assert.equal(out.error_code,'schema_error');
});

test('live adapter understands HTTP-date Retry-After values', async()=>{
  const now=new Date('2026-09-11T07:13:00Z');
  global.fetch=async()=>new Response('rate limited',{status:429,headers:{'retry-after':'Fri, 11 Sep 2026 07:20:00 GMT'}});
  const out=await fetchLiveReading({now});
  assert.equal(out.ok,false);
  assert.equal(out.error_code,'rate_limit');
  assert.equal(out.retry_after_seconds,420);
});

test('default upstream User-Agent identifies the public project repository', async()=>{
  const previous = process.env.UPSTREAM_CONTACT_URL;
  delete process.env.UPSTREAM_CONTACT_URL;
  let seenUserAgent='';
  global.fetch = async(_url, options={})=>{
    seenUserAgent=String(options.headers?.['user-agent']||'');
    return new Response(JSON.stringify({portdate:{number:22,data:{date:'2026-09-10',records:'123',portin:22}}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const out=await fetchLiveReading({now:new Date('2026-09-11T07:13:00Z')});
    assert.equal(out.ok,true);
    assert.match(seenUserAgent,/contact=https:\/\/github\.com\/youngjinphys\/SKT-ALEPH-T04/);
  } finally {
    if(previous===undefined) delete process.env.UPSTREAM_CONTACT_URL;
    else process.env.UPSTREAM_CONTACT_URL=previous;
  }
});
