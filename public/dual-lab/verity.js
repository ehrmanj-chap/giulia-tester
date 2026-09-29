import { DEFAULT_BACKENDS, defaultBackendFor } from './backend-defaults.js';
import { buildVerityCases, VERITY_META } from './verity-cases.js';

const $ = s => document.querySelector(s);
const run = $('#runVerity'), stop = $('#stopVerity'), download = $('#downloadVerity'), clear = $('#clearVerity');
const progress = $('#verityProgress'), summary = $('#veritySummary'), agentsEl = $('#verityAgentSummary'), recentEl = $('#verityRecent');
const concurrencyEl = $('#verityConcurrency'), countEl = $('#suiteCount');
const STORAGE_KEY = 'culturalAgentLab.connections.v1';
const RETRYABLE = new Set([429,500,502,503,504]);
const suite = buildVerityCases();
let state = { running:false, stop:false, startedAt:null, finishedAt:null, results:[], queues:{giulia:[],mei:[]} };
countEl.textContent = `${VERITY_META.total} cases`;
progress.max = VERITY_META.total;

function connections() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch {}
  return {
    giulia: { base: String(saved.giulia?.base || localStorage.getItem('giuliaApiBase') || defaultBackendFor('giulia')).trim().replace(/\/$/,''), token: saved.giulia?.token ?? localStorage.getItem('giuliaLabToken') ?? '' },
    mei: { base: String(saved.mei?.base || defaultBackendFor('mei')).trim().replace(/\/$/,''), token: saved.mei?.token ?? '' }
  };
}
function headers(agent, json=false) { const h={}; if(json) h['Content-Type']='application/json'; const t=connections()[agent].token; if(t) h['X-Giulia-Lab-Token']=t; return h; }
async function request(agent,path,opts={}) { const base=connections()[agent].base; if(!base) throw new Error(`${agent} backend not configured`); return fetch(`${base}${path}`,{...opts,headers:{...headers(agent,Boolean(opts.body)),...(opts.headers||{})}}); }
async function status(agent) {
  const r=await request(agent,'/api/status');
  const contentType=r.headers.get('content-type')||'';
  if(!contentType.includes('application/json')){
    const text=await r.text();
    if(/vercel|log in to vercel|deployment protection/i.test(text)) throw new Error(`${agent} backend is behind Vercel Deployment Protection`);
    throw new Error(`${agent} backend returned non-JSON (HTTP ${r.status})`);
  }
  const d=await r.json();
  if(!r.ok) throw new Error(d.error||`HTTP ${r.status}`);
  return d;
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function retrieval(diag) { return (diag?.calls||[]).flatMap(c=>(c.retrieval||[]).map(x=>({role:c.role||null,file:x.file||x.title||null,title:x.title||null,chunk:x.chunk??null,score:x.score??null}))); }
function metrics(text='') { const words=(text.match(/[\p{L}\p{N}'’-]+/gu)||[]), sentences=(text.match(/[^.!?]+[.!?]+/g)||[]); return {chars:text.length,words:words.length,sentences:sentences.length,paragraphs:text.trim()?text.trim().split(/\n\s*\n/).length:0,bullets:(text.match(/^\s*[-*•]\s+/gm)||[]).length,avgSentenceWords:sentences.length?Number((words.length/sentences.length).toFixed(1)):null,exclamations:(text.match(/!/g)||[]).length,questions:(text.match(/\?/g)||[]).length}; }
function sourcePass(expected, rows) { if(!expected?.length) return null; const hay=rows.map(x=>`${x.file||''} ${x.title||''}`.toLowerCase()).join(' '); return expected.some(s=>hay.includes(String(s).toLowerCase())); }
async function execute(test) {
  const t0=Date.now(); let last='';
  for(let attempt=1;attempt<=3;attempt++) {
    try {
      const r=await request(test.agent,'/api/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:test.question}]})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok) { last=d.error||`HTTP ${r.status}`; if(RETRYABLE.has(r.status)&&attempt<3){await sleep(800*attempt);continue;} throw new Error(last); }
      const rows=retrieval(d.diagnostics), reply=String(d.reply||'');
      return {...test,attempts:attempt,elapsedMs:Date.now()-t0,actualRoute:d.route??null,routePass:d.route===test.expectedRoute,runId:d.runId??null,model:d.model??null,reply,diagnostics:d.diagnostics??null,retrieval:rows,retrievalPresent:rows.length>0,sourceHintPass:sourcePass(test.expectedSources,rows),prosody:metrics(reply),error:null};
    } catch(e) { last=e.message; if(attempt<3){await sleep(800*attempt);continue;} }
  }
  return {...test,attempts:3,elapsedMs:Date.now()-t0,actualRoute:null,routePass:false,runId:null,model:null,reply:'',diagnostics:null,retrieval:[],retrievalPresent:false,sourceHintPass:null,prosody:metrics(''),error:last||'Unknown error'};
}
function summarize(results=state.results) {
  const byAgent={};
  for(const agent of ['giulia','mei']) { const a=results.filter(x=>x.agent===agent), ok=a.filter(x=>!x.error), rc=a.filter(x=>x.expectedRoute); byAgent[agent]={attempted:a.length,successful:ok.length,errors:a.filter(x=>x.error).length,routePasses:rc.filter(x=>x.routePass).length,routeChecks:rc.length,retrievalPresent:ok.filter(x=>x.retrievalPresent).length,avgLatencyMs:ok.length?Math.round(ok.reduce((n,x)=>n+x.elapsedMs,0)/ok.length):null}; }
  return {completed:results.length,errors:results.filter(x=>x.error).length,byAgent};
}
function render() {
  const s=summarize(), queued=state.queues.giulia.length+state.queues.mei.length; progress.value=state.results.length;
  summary.textContent=state.running?`${state.results.length}/${VERITY_META.total} finished · ${queued} queued${state.stop?' · stopping':''}`:state.results.length?`${state.results.length}/${VERITY_META.total} recorded · ${s.errors} errors`:`Ready: ${VERITY_META.total} isolated cases · ${VERITY_META.perAgent} Giulia · ${VERITY_META.perAgent} Mei`;
  agentsEl.innerHTML=['giulia','mei'].map(a=>{const x=s.byAgent[a];return `<div><strong>${a==='giulia'?'🇮🇹 Giulia':'🇯🇵 Mei'}</strong><span>${x.attempted}/${VERITY_META.perAgent} · routes ${x.routePasses}/${x.routeChecks||0} · retrieval ${x.retrievalPresent}/${x.successful||0} · errors ${x.errors}</span></div>`}).join('');
  recentEl.innerHTML=state.results.slice(-10).reverse().map(x=>`<div class="verity-row"><code>${x.id}</code><span>${x.error?'error':x.actualRoute||'no route'} · ${x.elapsedMs} ms · RAG ${x.retrieval.length}</span></div>`).join('')||'<div class="muted">No verity results yet.</div>';
  download.disabled=!state.results.length; clear.disabled=state.running;
}
async function worker(agent){ while(!state.stop){ const test=state.queues[agent].shift(); if(!test)return; state.results.push(await execute(test)); render(); } }
function report(){ return {reportType:'cultural-agent-dual-verity',suite:VERITY_META,startedAt:state.startedAt,finishedAt:state.finishedAt,exportedAt:new Date().toISOString(),stoppedEarly:state.stop&&state.results.length<VERITY_META.total,backends:{giulia:{base:connections().giulia.base},mei:{base:connections().mei.base}},reviewProtocol:{technical:['routePass','retrievalPresent','sourceHintPass','error','elapsedMs','diagnostics/retrieval'],qualitative:['Read full replies for personality continuity, cultural nuance, natural cadence, and prosody.','Watch for generic FAQ voice, repetitive templates, choppy caveats, over-sectioning, or loss of distinct Giulia/Mei voice.']},technicalSummary:summarize(),results:state.results}; }
function downloadReport(){ if(!state.results.length)return; const blob=new Blob([JSON.stringify(report(),null,2)],{type:'application/json'}), a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`dual-verity-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
run.addEventListener('click',async()=>{ if(state.running)return; run.disabled=true; try { await Promise.all(['giulia','mei'].map(status)); state={running:true,stop:false,startedAt:new Date().toISOString(),finishedAt:null,results:[],queues:{giulia:suite.filter(x=>x.agent==='giulia').map(x=>({...x})),mei:suite.filter(x=>x.agent==='mei').map(x=>({...x}))}}; stop.disabled=false; clear.disabled=true; render(); const n=Math.max(1,Math.min(4,Number(concurrencyEl.value)||2)), ws=[]; for(const a of ['giulia','mei'])for(let i=0;i<n;i++)ws.push(worker(a)); await Promise.all(ws); state.running=false; state.finishedAt=new Date().toISOString(); stop.disabled=true; clear.disabled=false; render(); if(!state.stop&&state.results.length===VERITY_META.total)downloadReport(); } catch(e){ alert(`Verity run could not start: ${e.message}`); } finally { state.running=false; run.disabled=false; stop.disabled=true; clear.disabled=false; render(); }});
stop.addEventListener('click',()=>{state.stop=true;stop.disabled=true;render();});
download.addEventListener('click',downloadReport);
clear.addEventListener('click',()=>{if(state.running)return;state={running:false,stop:false,startedAt:null,finishedAt:null,results:[],queues:{giulia:[],mei:[]}};render();});
render();
