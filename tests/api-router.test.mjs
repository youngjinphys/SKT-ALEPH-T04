import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../src/domain.mjs';
import { createApiRouter } from '../src/api-router.mjs';

class MemoryRepo{constructor(){this.state=emptyState('live')}async read(){return structuredClone(this.state)}async transact(fn){this.state=await fn(structuredClone(this.state));return structuredClone(this.state)}}
const fixture=(id,value,date='2026-08-24')=>({fixture_id:id,virtual_now:`${date}T03:00:00.000Z`,transport:{mode:'response',status:200,headers:{}},payload:{signal_id:'demo.signal',normalized_value:value,unit:'pt',source_name:'fixture',source_url:'https://example.invalid/source',source_time:`${date}T00:00:00.000Z`,fetched_at:`${date}T03:00:00.000Z`,record_timezone:'Asia/Seoul',record_date:date}});
const fixtures=new Map([['A',fixture('A',100)],['B',fixture('B',105)]]);
const session='11111111-1111-4111-8111-111111111111';
function cookieFrom(res){return res.headers.get('set-cookie').split(';',1)[0];}

test('status uses Supabase-backed live repo but synthetic replay starts empty',async()=>{
 const route=createApiRouter({liveRepo:new MemoryRepo(),fixtures,fetchReading:async()=>{throw new Error('unused')}});
 const res=await route(new Request(`https://board.example/api/router?path=status&replay_session=${session}`));
 assert.equal(res.status,200);const j=await res.json();assert.equal(j.storage,'supabase');assert.equal(j.live.daily_readings.length,0);assert.equal(j.replay.daily_readings.length,0);
});

test('replay state is carried only in a bounded HttpOnly session cookie, not the database',async()=>{
 const repo=new MemoryRepo(); const route=createApiRouter({liveRepo:repo,fixtures,fetchReading:async()=>{throw new Error('unused')}});
 let res=await route(new Request(`https://board.example/api/router?path=replay/A&session=${session}`,{method:'POST'}));
 let j=await res.json();assert.equal(j.state.current_reading.normalized_value,100);const cookie=cookieFrom(res);assert.match(res.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 res=await route(new Request(`https://board.example/api/router?path=replay/B&session=${session}`,{method:'POST',headers:{cookie}}));
 j=await res.json();assert.equal(j.state.current_reading.normalized_value,105);assert.equal((await repo.read()).daily_readings.length,0);
 const cookie2=cookieFrom(res);
 res=await route(new Request(`https://board.example/api/router?path=status&replay_session=${session}`,{headers:{cookie:cookie2}}));
 j=await res.json();assert.equal(j.replay.current_reading.normalized_value,105);
});

test('a cookie from another replay session is ignored',async()=>{
 const route=createApiRouter({liveRepo:new MemoryRepo(),fixtures,fetchReading:async()=>{throw new Error('unused')}});
 let res=await route(new Request(`https://board.example/api/router?path=replay/A&session=${session}`,{method:'POST'}));const cookie=cookieFrom(res);
 res=await route(new Request('https://board.example/api/router?path=status&replay_session=22222222-2222-4222-8222-222222222222',{headers:{cookie}}));
 assert.equal((await res.json()).replay.daily_readings.length,0);
});

test('cross-site mutation is rejected',async()=>{
 const route=createApiRouter({liveRepo:new MemoryRepo(),fixtures,fetchReading:async()=>{throw new Error('unused')}});
 const res=await route(new Request('https://board.example/api/router?path=replay/reset',{method:'POST',headers:{origin:'https://evil.example','sec-fetch-site':'cross-site'}}));
 assert.equal(res.status,403);
});
