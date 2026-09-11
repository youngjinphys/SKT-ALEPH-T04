const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat('en-US');
const fixtures = [
  ['T04-NORMAL-D1-A','D1 / 100','normal'],['T04-NORMAL-D1-B','D1 UPSERT / 105','normal'],['T04-NORMAL-D2','D2 / 120','recover'],
  ['T04-TIMEOUT','TIMEOUT','fail'],['T04-AUTH-401','AUTH 401','fail'],['T04-RATE-429','RATE 429','fail'],
  ['T04-OFFLINE','OFFLINE','fail'],['T04-SCHEMA-BREAK','SCHEMA BREAK','fail'],['T04-RECOVER-D2','RECOVER D2','recover']
];
const errorDetails = {
  timeout: 'Upstream exceeded the response deadline.',
  auth: 'Upstream rejected the request with 401/403.',
  rate_limit: 'Upstream rate limit was reached.',
  offline: 'The upstream network request could not be completed.',
  schema_error: 'Upstream data failed schema validation.'
};
let latest = null;
const replaySession = (() => {
  const key = 't04-replay-session';
  let value = sessionStorage.getItem(key);
  if (!value) {
    value = globalThis.crypto?.randomUUID?.() || `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12,'0').slice(0,12)}`;
    sessionStorage.setItem(key, value);
  }
  return value;
})();
const replaySuffix = `?session=${encodeURIComponent(replaySession)}`;

function kstTime(iso){
  if(!iso)return '—';
  const date=new Date(iso);
  if(Number.isNaN(date.getTime()))return '—';
  return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'medium',hour12:false}).format(date)+' KST';
}
function sourceObservedText(value,precision){
  if(!value)return '—';
  if(precision==='day')return `${String(value).slice(0,10)} UTC (day precision)`;
  return `${value}${precision&&precision!=='unknown'?` (${precision} precision)`:''}`;
}
function statusCopy(state){
  if(!state?.status)return ['unknown','NO LIVE RECORD','error: none'];
  if(state.status.freshness==='fresh')return ['fresh','FRESH / VERIFIED','error: none'];
  if(state.current_reading)return ['stale','STALE / LAST GOOD VALUE',`error: ${state.status.error_code}`];
  return ['error','UNAVAILABLE / NO GOOD VALUE',`error: ${state.status.error_code}`];
}
function liveDetailText(state){
  if(!state?.status)return 'No live fetch has been attempted. No value is being presented as current.';
  if(state.status.freshness==='fresh'){
    const period=state.current_meta?.source_period;
    return `Validated public aggregate preserved${period?` for ${period}`:''}.`;
  }
  const code=state.status.error_code;
  const reason=errorDetails[code]||'The upstream request failed.';
  return state.current_reading
    ? `${reason} Displaying the last successfully validated value as stale.`
    : `${reason} No trustworthy live value is available yet.`;
}
function deltaText(c){
  if(!c||c.state==='insufficient')return 'insufficient history';
  if(c.state==='unit_mismatch')return 'unit mismatch';
  const sign=c.signed>0?'+':''; return `${sign}${fmt.format(c.signed)} ${c.unit}`;
}
function renderSpark(rows){
  const vals=rows.slice(-10).map(r=>r.normalized_value); const path=$('#sparkPath'),area=$('#sparkArea');
  if(vals.length<2){path.setAttribute('d','M0 118 L640 118');area.setAttribute('d','M0 118 L640 118 L640 118 L0 118 Z');return}
  const min=Math.min(...vals),max=Math.max(...vals),range=Math.max(1,max-min); const pts=vals.map((v,i)=>{const x=i*(640/(vals.length-1));const y=112-((v-min)/range)*92;return [x,y]});
  const d=pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '); path.setAttribute('d',d);area.setAttribute('d',`${d} L640 118 L0 118 Z`);
}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function evidenceCopy(count){
  if(count===2)return '2 / 2 actual KST dates ready';
  if(count>2)return `${count} stored · submit exactly 2 canonical receipts`;
  return `${count} / 2 actual KST dates`;
}
function renderLive(state){
  latest=state;
  const [klass,label,error]=statusCopy(state);
  $('#liveDot').className=`status-dot ${klass}`;
  $('#liveStatus').textContent=label;
  $('#liveError').textContent=error;
  $('#liveDetail').textContent=liveDetailText(state);

  const r=state.current_reading,m=state.current_meta;
  const rows=state.daily_readings||[];
  $('#liveValue').textContent=r?fmt.format(r.normalized_value):'—';
  $('#liveUnit').textContent=r?`UNIT: ${r.unit.toUpperCase()} · SIGNAL: TCP/22`:'UNIT: — · SIGNAL: TCP/22';
  $('#liveDelta').textContent=deltaText(state.last_comparison);
  $('#sourceName').textContent=r?.source_name||'SANS ISC / DShield';
  $('#sourcePeriod').textContent=m?.source_period||'Not fetched';
  $('#sourceObserved').textContent=sourceObservedText(m?.source_observed_at,m?.source_observed_precision);
  $('#fetchedAt').textContent=r?kstTime(r.fetched_at):'—';
  $('#lastAttempt').textContent=state.last_run?.attempted_at?kstTime(state.last_run.attempted_at):'—';
  $('#evidenceCount').textContent=evidenceCopy(rows.length);
  $('#rawHash').textContent=m?.raw_sha256?`${m.raw_sha256.slice(0,14)}…${m.raw_sha256.slice(-10)}`:'—';
  $('#sourceLink').href=r?.source_url||'https://isc.sans.edu/api/';
  $('#rawAggregate').textContent=m?.raw_aggregate?JSON.stringify(m.raw_aggregate,null,2):'awaiting live fetch';
  $('#normalizedView').textContent=r?JSON.stringify(r,null,2):'awaiting live fetch';

  const body=$('#historyBody');
  renderSpark(rows);
  if(!rows.length){body.innerHTML='<tr><td colspan="8" class="empty">No live records yet.</td></tr>';return}
  body.innerHTML=rows.slice().reverse().map(row=>{
    const sourceUrl=row.reading?.source_url||'—';
    const safeSource=escapeHtml(sourceUrl);
    const sourceCell=sourceUrl==='—'?'—':`<a class="table-source" href="${safeSource}" rel="noopener noreferrer" target="_blank">${safeSource}</a>`;
    return `<tr>
      <td>${escapeHtml(row.record_date)}</td>
      <td>${escapeHtml(fmt.format(row.normalized_value))} ${escapeHtml(row.unit)}</td>
      <td>${escapeHtml(row.source_period||'—')}</td>
      <td>${escapeHtml(sourceObservedText(row.source_observed_at,row.source_observed_precision))}</td>
      <td>${escapeHtml(kstTime(row.first_fetched_at))}</td>
      <td>${escapeHtml(kstTime(row.last_fetched_at))}</td>
      <td>${sourceCell}</td>
      <td class="integrity">SHA-256 ${escapeHtml(row.raw_sha256?row.raw_sha256.slice(0,10)+'…':'—')}</td>
    </tr>`;
  }).join('');
}
function renderReplay(state){
  const rows=state.daily_readings?.length||0; const value=state.current_reading?.normalized_value??null;
  $('#replayFreshness').textContent=state.status?.freshness||'empty'; $('#replayError').textContent=state.status?.error_code||'none'; $('#replayValue').textContent=value===null?'—':`${fmt.format(value)} ${state.current_reading.unit}`; $('#replayRows').textContent=String(rows);
  const retry=$('#retryReplay'); retry.hidden=state.status?.freshness!=='stale';
  const out={status:state.status,daily_rows:rows,current_value:value,record_date:state.current_reading?.record_date??null,comparison:state.last_comparison,last_run:state.last_run};
  $('#terminalOutput').textContent=`$ replay-state\n${JSON.stringify(out,null,2)}\n`;
}
function toast(msg,bad=false){const t=$('#toast');t.textContent=msg;t.className=`toast show${bad?' bad':''}`;clearTimeout(t._timer);t._timer=setTimeout(()=>t.className='toast',3600)}
async function api(path,options){const r=await fetch(path,{...options,headers:{'content-type':'application/json',...(options?.headers||{})}});let data={};try{data=await r.json()}catch{}if(!r.ok)throw Object.assign(new Error(data.message||data.error||`HTTP ${r.status}`),{data});return data}
async function load(){const data=await api('/api/status?replay_session='+encodeURIComponent(replaySession));renderLive(data.live);renderReplay(data.replay)}
async function refreshLive(){const btn=$('#refreshLive');btn.disabled=true;btn.querySelector('span').textContent='FETCHING…';try{const data=await api('/api/live/refresh',{method:'POST'});renderLive(data.state);toast(data.upstream_fetch?'Live public aggregate fetched and preserved.':'Preserved aggregate reused; upstream was not called again.')}catch(e){if(e.data?.state)renderLive(e.data.state);toast(`Live fetch failed honestly: ${e.message}`,true)}finally{btn.disabled=false;btn.querySelector('span').textContent='LIVE REFRESH'}}
function buildFixtures(){const grid=$('#fixtureGrid');grid.innerHTML=fixtures.map(([id,label,type])=>`<button class="fixture ${type}" data-fixture="${id}"><strong>${label}</strong><span>${id}</span></button>`).join('');grid.addEventListener('click',async e=>{const b=e.target.closest('[data-fixture]');if(!b)return;b.disabled=true;try{const data=await api('/api/replay/'+encodeURIComponent(b.dataset.fixture)+replaySuffix,{method:'POST'});renderReplay(data.state);toast(`${b.dataset.fixture} replayed in synthetic state.`)}catch(e){toast(e.message,true)}finally{b.disabled=false}});document.querySelector('[data-action="reset"]').addEventListener('click',async()=>{const data=await api('/api/replay/reset'+replaySuffix,{method:'POST'});renderReplay(data.state);toast('Synthetic replay state reset. Live records were untouched.')})}
$('#retryReplay').addEventListener('click',async()=>{const b=$('#retryReplay');b.disabled=true;try{const data=await api('/api/replay/T04-RECOVER-D2'+replaySuffix,{method:'POST'});renderReplay(data.state);toast('Retry succeeded: synthetic state recovered to fresh/none.')}catch(e){toast(e.message,true)}finally{b.disabled=false}});
function tick(){const now=new Date();$('#clock').textContent=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now)+' KST'}
$('#refreshLive').addEventListener('click',refreshLive);buildFixtures();tick();setInterval(tick,1000);load().catch(e=>toast(`Dashboard state unavailable: ${e.message}`,true));
