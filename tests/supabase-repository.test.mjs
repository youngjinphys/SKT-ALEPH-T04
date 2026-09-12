import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseStateRepository, supabaseConfigFromEnv, StorageConfigurationError } from '../src/supabase-repository.mjs';
import { emptyState } from '../src/domain.mjs';

function response(status, body){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});}

test('requires server-side Supabase URL and secret key',()=>{
  assert.throws(()=>supabaseConfigFromEnv({}),StorageConfigurationError);
  assert.deepEqual(supabaseConfigFromEnv({SUPABASE_URL:'https://abc.supabase.co/',SUPABASE_SECRET_KEY:'sb_secret_test'}),{url:'https://abc.supabase.co',key:'sb_secret_test'});
  assert.throws(()=>supabaseConfigFromEnv({SUPABASE_URL:'http://abc.supabase.co',SUPABASE_SECRET_KEY:'x'}),/HTTPS/);
});

test('empty Supabase table maps to empty live state without creating a row',async()=>{
  const calls=[];
  const repo=new SupabaseStateRepository({url:'https://abc.supabase.co',key:'secret',fetchFn:async(url,init)=>{calls.push([url.toString(),init]);return response(200,[]);}});
  const state=await repo.read();
  assert.equal(state.kind,'live'); assert.equal(state.daily_readings.length,0); assert.equal(calls.length,1); assert.equal(calls[0][1].method,'GET');
  assert.equal(calls[0][1].headers.apikey,'secret'); assert.equal(calls[0][1].headers.authorization,'Bearer secret');
});

test('transaction inserts the single live state row when missing',async()=>{
  const calls=[];
  const repo=new SupabaseStateRepository({url:'https://abc.supabase.co',key:'secret',fetchFn:async(url,init)=>{
    calls.push([url.toString(),init]);
    if(init.method==='GET')return response(200,[]);
    if(init.method==='POST')return response(201,[{state:{kind:'live'},version:1}]);
    throw new Error('unexpected');
  }});
  const next=await repo.transact(state=>({...state,sequence:state.sequence+1}));
  assert.equal(next.sequence,1); assert.deepEqual(calls.map(x=>x[1].method),['GET','POST']);
  const body=JSON.parse(calls[1][1].body); assert.equal(body[0].state_key,'live'); assert.equal(body[0].version,1);
});

test('optimistic compare-and-swap retries instead of losing a concurrent update',async()=>{
  let getCount=0, patchCount=0;
  const first={...emptyState('live'),sequence:1}; const second={...emptyState('live'),sequence:4};
  const repo=new SupabaseStateRepository({url:'https://abc.supabase.co',key:'secret',fetchFn:async(url,init)=>{
    if(init.method==='GET'){getCount++;return response(200,[{state:getCount===1?first:second,version:getCount===1?2:3}]);}
    if(init.method==='PATCH'){patchCount++;return response(200,patchCount===1?[]:[{state:{},version:4}]);}
    throw new Error('unexpected');
  }});
  const next=await repo.transact(state=>({...state,sequence:state.sequence+1}));
  assert.equal(next.sequence,5); assert.equal(getCount,2); assert.equal(patchCount,2);
});

test('repository is deliberately restricted to the one live row',()=>{
  assert.throws(()=>new SupabaseStateRepository({url:'https://abc.supabase.co',key:'x',stateKey:'replay:abc'}),/single live state row/);
});
