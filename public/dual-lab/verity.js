import { loadConnections, endpointUrl } from './backend-defaults.js';
import { buildVerityCases, VERITY_META } from './verity-cases.js';

const $ = s => document.querySelector(s);
const run = $('#runVerity'), stop = $('#stopVerity'), download = $('#downloadVerity'), clear = $('#clearVerity');
const progress = $('#verityProgress'), summary = $('#veritySummary'), agentsEl = $('#verityAgentSummary'), recentEl = $('#verityRecent');
const concurrencyEl = $('#verityConcurrency'), countEl = $('#suiteCount');
const RESULT_KEY = 'culturalAgentLab.verity.v2';
const RETRYABLE = new Set([429,500,502,503,504]);
const suite = buildVerityCases();
let state = { running:false, stop:false, startedAt:null, finishedAt:null, results:[], queues:{giulia:[],mei:[]} };
countEl.textContent = `${VERITY_META.total} cases`;
progress.max = VERITY_META.total;

function connections() { return loadConnections(); }
function headers(agent, json=false) { const h={}; if(json) h['Content-Type']='application/json'; const t=connections()[agent].token; if(t) h['X-Giulia-Lab-Token']=t; return h; }
async function request(agent,path,opts={}) { const base=connections()[agent].base; if(!base) throw new Error(`${agent} backend not configured`); return fetch(endpointUrl(base,path),{...opts,signal:AbortSignal.timeout(path==='/api/status'?20000:240000),headers:{...headers(agent,Boolean(opts.body)),...(opts.headers||{})}}); }
async function status(agent) {
  const r=await request(agent,'/api/status');
  const contentType=r.headers.get('content-type')||'';
  if(!contentType.includes('application/json')){
    const text=await r.text();
    if(/vercel|log in to vercel|deployment protection/i.test(text)) throw new Error(`${agent} backend is behind Vercel Deployment Protection`);
    throw new Error(`${agent} backend returned non-JSON (HTTP ${r.status})`);
  }
  const d=await r.json();
  if(!r.ok||d.ok===false) throw new Error(d.error||`HTTP ${r.status}`);
  if(agent==='mei'&&(d.corpusVersion!==VERITY_META.requiredMeiCorpus||d.knowledge?.cultural?.documents!==74||d.knowledge?.business?.documents!==80))throw new Error('Mei is still on an old or incomplete corpus. Expected 74 cultural + 80 business documents; deploy the updated backend before testing.');
  if(d.provider==='mock')throw new Error(`${agent} is using a mock provider; live evaluation is blocked.`);
  return d;
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function retrieval(diag) { return (diag?.calls||[]).flatMap(c=>(c.retrieval||[]).map(x=>({role:c.role||null,id:x.id||null,sourceUrl:x.sourceUrl||null,file:x.file||x.title||null,title:x.title||null,chunk:x.chunk??null,score:x.score??null}))); }
function metrics(text='') { const words=(text.match(/[\p{L}\p{N}'’-]+/gu)||[]), sentences=(text.match(/[^.!?]+[.!?]+/g)||[]); return {chars:text.length,words:words.length,sentences:sentences.length,paragraphs:text.trim()?text.trim().split(/\n\s*\n/).length:0,bullets:(text.match(/^\s*[-*•]\s+/gm)||[]).length,avgSentenceWords:sentences.length?Number((words.length/sentences.length).toFixed(1)):null,exclamations:(text.match(/!/g)||[]).length,questions:(text.match(/\?/g)||[]).length}; }
function sourcePass(expected, rows) { if(!expected?.length) return null; const hay=rows.map(x=>`${x.file||''} ${x.title||''}`.toLowerCase()).join(' '); return expected.some(s=>hay.includes(String(s).toLowerCase())); }
async function execute(test) {
  const t0=Date.now(); let last='',attempts=0;
  for(let attempt=1;attempt<=3;attempt++) { attempts=attempt;
    try {
      const r=await request(test.agent,'/api/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:test.question}]})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok) { last=d.error||`HTTP ${r.status}`; if(RETRYABLE.has(r.status)&&attempt<3){await sleep(800*attempt);continue;} return {...test,attempts:attempt,elapsedMs:Date.now()-t0,actualRoute:null,routePass:false,reply:'',retrieval:[],retrievalPresent:false,sourceHintPass:null,prosody:metrics(''),error:last}; }
      const rows=retrieval(d.diagnostics), reply=String(d.reply||'');if(!reply.trim())throw new Error('Empty reply');
      return {...test,attempts:attempt,elapsedMs:Date.now()-t0,actualRoute:d.route??null,routePass:(test.acceptableRoutes||[test.expectedRoute]).includes(d.route),runId:d.runId??null,model:d.model??null,reply,diagnostics:d.diagnostics??null,retrieval:rows,retrievalPresent:rows.length>0,sourceHintPass:sourcePass(test.expectedSources,rows),prosody:metrics(reply),error:null};
    } catch(e) { last=e.message; if(attempt<3){await sleep(800*attempt);continue;} }
  }
  return {...test,attempts,elapsedMs:Date.now()-t0,actualRoute:null,routePass:false,runId:null,model:null,reply:'',diagnostics:null,retrieval:[],retrievalPresent:false,sourceHintPass:null,prosody:metrics(''),error:last||'Unknown error'};
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
async function worker(agent){ while(!state.stop){ const test=state.queues[agent].shift(); if(!test)return; state.results.push(await execute(test)); checkpoint(); render(); } }
function report(){ return {reportType:'cultural-agent-dual-verity',preflight:state.preflight||null,suite:VERITY_META,startedAt:state.startedAt,finishedAt:state.finishedAt,exportedAt:new Date().toISOString(),stoppedEarly:state.stop&&state.results.length<VERITY_META.total,backends:{giulia:{base:connections().giulia.base},mei:{base:connections().mei.base}},reviewProtocol:{technical:['routePass','retrievalPresent','sourceHintPass','error','elapsedMs','diagnostics/retrieval'],qualitative:['Read full replies for personality continuity, cultural nuance, natural cadence, and prosody.','Watch for generic FAQ voice, repetitive templates, choppy caveats, over-sectioning, or loss of distinct Giulia/Mei voice.']},technicalSummary:summarize(),results:state.results}; }
function downloadReport(){ if(!state.results.length)return; const blob=new Blob([JSON.stringify(report(),null,2)],{type:'application/json'}), a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`dual-verity-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
run.addEventListener('click',async()=>{ if(state.running)return;if(state.results.length){alert('Download or clear the existing results before starting a new run.');return;} run.disabled=true; try { const preflight=Object.fromEntries(await Promise.all(['giulia','mei'].map(async a=>[a,await status(a)]))); state={preflight,running:true,stop:false,startedAt:new Date().toISOString(),finishedAt:null,results:[],queues:{giulia:suite.filter(x=>x.agent==='giulia').map(x=>({...x})),mei:suite.filter(x=>x.agent==='mei').map(x=>({...x}))}}; stop.disabled=false; clear.disabled=true; render(); const n=Math.max(1,Math.min(4,Number(concurrencyEl.value)||2)), ws=[]; for(const a of ['giulia','mei'])for(let i=0;i<n;i++)ws.push(worker(a)); await Promise.all(ws); state.running=false; state.finishedAt=new Date().toISOString();checkpoint(); stop.disabled=true; clear.disabled=false; render(); if(!state.stop&&state.results.length===VERITY_META.total)downloadReport(); } catch(e){ alert(`Verity run could not start: ${e.message}`); } finally { state.running=false; run.disabled=false; stop.disabled=true; clear.disabled=false; render(); }});
stop.addEventListener('click',()=>{state.stop=true;stop.disabled=true;render();});
download.addEventListener('click',downloadReport);
clear.addEventListener('click',()=>{if(state.running)return;try{localStorage.removeItem(RESULT_KEY);}catch{}state={running:false,stop:false,startedAt:null,finishedAt:null,results:[],queues:{giulia:[],mei:[]}};render();});
render();

function checkpoint(){try{localStorage.setItem(RESULT_KEY,JSON.stringify(report()));}catch{summary.textContent+=' · Browser storage full: download the partial report.';}}
try{const saved=JSON.parse(localStorage.getItem(RESULT_KEY)||'null');if(saved?.suite?.version===VERITY_META.version&&Array.isArray(saved.results)&&saved.results.length){state={...state,...saved,running:false,stop:saved.results.length<VERITY_META.total,queues:{giulia:[],mei:[]}};render();}}catch{}
window.addEventListener('beforeunload',event=>{if(state.running){event.preventDefault();event.returnValue='';}});
