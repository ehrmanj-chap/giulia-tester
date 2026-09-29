import { defaultBackendFor, loadConnections, saveConnections, endpointUrl } from './backend-defaults.js';
const $ = s => document.querySelector(s);
const AGENTS = {
  giulia:{name:'Giulia',label:'Giulia (Italy Expert)',country:'ITALY',description:'Italian cultural and business intelligence',welcome:'Ciao! What would you like to explore about life, culture, or business in Italy?'},
  mei:{name:'Mei',label:'Mei (Japan Expert)',country:'JAPAN',description:'Japanese cultural and business intelligence',welcome:'Konnichiwa! What would you like to explore about daily life, culture, or business in Japan?'}
};
let selectedAgent='giulia', connections=loadConnections();
const histories={giulia:[],mei:[]}, pending={giulia:false,mei:false}, health={giulia:null,mei:null}, checkIds={giulia:0,mei:0}, runDiagnostics={giulia:null,mei:null}, drafts={giulia:'',mei:''};
function renderMessages(){
  const box=$('#messages');box.replaceChildren();
  if(!histories[selectedAgent].length){const p=document.createElement('p');p.className='system-note';p.textContent=AGENTS[selectedAgent].welcome;box.append(p);}
  for(const m of histories[selectedAgent]){const el=document.createElement('div');el.className=`msg ${m.role}`;el.textContent=m.content;box.append(el);}
  box.scrollTop=box.scrollHeight;
}
function renderHealth(){
  const h=health[selectedAgent], s=$('#backendStatus');s.textContent=h?.label||'Not connected';s.className=`status-pill ${h?.tone||'neutral'}`;
  $('#connectionDetails').textContent=h?.detail||'';
  $('#send').disabled=pending[selectedAgent]||h?.tone!=='ok';$('#send').textContent=pending[selectedAgent]?'Thinking…':'Send';
  $('#resetChat').disabled=pending[selectedAgent];
}
function render(){
  const a=AGENTS[selectedAgent];$('#agentName').textContent=a.label;$('#agentCountry').textContent=a.country;$('#agentDescription').textContent=a.description;
  $('#agentPortrait').src=`./assets/${selectedAgent}.png`;$('#agentPortrait').alt=a.name;$('#agentSelect').value=selectedAgent;
  $('#input').placeholder=`Ask ${a.name}…`;$('#input').value=drafts[selectedAgent];
  $('#backendUrl').value=connections[selectedAgent].base;$('#labToken').value=connections[selectedAgent].token;
  $('#backendHint').textContent=selectedAgent==='mei'?'The updated lab serves Mei at /api/mei. A standalone Mei backend can also be configured.':'Uses the current origin on a backend host. GitHub Pages needs a hosted Giulia URL.';
  $('#diagnostics').textContent=runDiagnostics[selectedAgent]?JSON.stringify(runDiagnostics[selectedAgent],null,2):'No response yet.';
  $('#routeBadge').classList.toggle('hidden',!runDiagnostics[selectedAgent]);$('#routeBadge').textContent=runDiagnostics[selectedAgent]?.route||'';
  renderMessages();renderHealth();
}
async function request(agent,path,options={}){
  const c=connections[agent];if(!c.base)throw new Error('Backend URL is not configured. Open Internal lab tools to connect.');
  const headers={'Content-Type':'application/json',...(c.token?{'X-Giulia-Lab-Token':c.token}:{})};
  const res=await fetch(endpointUrl(c.base,path),{...options,headers,signal:AbortSignal.timeout(path==='/api/status'?20000:240000)});
  if(!(res.headers.get('content-type')||'').includes('application/json'))throw new Error(`Backend returned a non-JSON response (HTTP ${res.status}); check its URL and Vercel access.`);
  const data=await res.json();if(!res.ok||data.ok===false)throw new Error(data.error||`HTTP ${res.status}`);return data;
}
async function checkBackend(agent=selectedAgent){
  const check=++checkIds[agent];health[agent]={label:'Connecting…',tone:'neutral'};if(agent===selectedAgent)renderHealth();
  try{const d=await request(agent,'/api/status');if(check!==checkIds[agent])return;
    const k=d.knowledge;health[agent]={label:'Connected',tone:'ok',detail:`${AGENTS[agent].name}: ${k?.cultural?.documents??'?'} cultural · ${k?.business?.documents??'?'} business documents${d.corpusVersion?` · ${d.corpusVersion}`:''}`};
  }catch(e){if(check!==checkIds[agent])return;health[agent]={label:'Connection unavailable',tone:'bad',detail:e.message};}
  if(agent===selectedAgent)renderHealth();
}
function selectAgent(agent,openChat=true){
  drafts[selectedAgent]=$('#input').value;selectedAgent=agent;render();
  if(openChat){$('#expertSelection').classList.add('hidden');$('#chatPanel').classList.remove('hidden');$('#input').focus();}
  checkBackend(agent);
}
for(const card of document.querySelectorAll('[data-agent]'))card.addEventListener('click',()=>selectAgent(card.dataset.agent));
$('#changeExpert').addEventListener('click',()=>{$('#chatPanel').classList.add('hidden');$('#expertSelection').classList.remove('hidden');$('#selectionHeading').focus();});
$('#agentSelect').addEventListener('change',()=>selectAgent($('#agentSelect').value,false));
$('#saveConnection').addEventListener('click',()=>{
  const base=$('#backendUrl').value.trim().replace(/\/+$/,'')||defaultBackendFor(selectedAgent);
  if(base){try{const u=new URL(base);if(!['http:','https:'].includes(u.protocol))throw Error();}catch{$('#connectionDetails').textContent='Enter a valid http or https backend URL.';return;}}
  connections[selectedAgent]={base,token:$('#labToken').value.trim()};saveConnections(connections);render();checkBackend();
});
$('#clearConnection').addEventListener('click',()=>{connections[selectedAgent]={base:defaultBackendFor(selectedAgent),token:''};saveConnections(connections);render();checkBackend();});
$('#checkBackend').addEventListener('click',()=>checkBackend());
$('#resetChat').addEventListener('click',()=>{if(pending[selectedAgent])return;histories[selectedAgent]=[];runDiagnostics[selectedAgent]=null;drafts[selectedAgent]='';render();$('#input').focus();});
$('#input').addEventListener('input',()=>drafts[selectedAgent]=$('#input').value);
$('#input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chatForm').requestSubmit();}});
$('#chatForm').addEventListener('submit',async e=>{
  e.preventDefault();const agent=selectedAgent,text=$('#input').value.trim();if(!text||pending[agent]||health[agent]?.tone!=='ok')return;
  histories[agent].push({role:'user',content:text});drafts[agent]='';$('#input').value='';pending[agent]=true;renderMessages();renderHealth();
  try{const d=await request(agent,'/api/chat',{method:'POST',body:JSON.stringify({messages:histories[agent].filter(m=>!m.error)})});if(typeof d.reply!=='string'||!d.reply.trim())throw new Error('Backend returned an empty reply.');histories[agent].push({role:'assistant',content:d.reply});runDiagnostics[agent]={agent,runId:d.runId,route:d.route,diagnostics:d.diagnostics};}
  catch(e){histories[agent].push({role:'assistant',content:`The response could not be completed: ${e.message}`,error:true});}
  finally{pending[agent]=false;if(selectedAgent===agent){render();$('#input').focus();}}
});
render();
