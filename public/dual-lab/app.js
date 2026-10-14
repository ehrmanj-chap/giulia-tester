import { defaultBackendFor, loadConnections, saveConnections, endpointUrl } from './backend-defaults.js';
import { BrowserSpeech, hasBrowserSpeech } from './voice/browser-speech.js';
import { VoiceGateway } from './voice/clients.js';
import { AudioPlayer } from './voice/audio.js';
import { speechSegments } from './voice/core.js';
const $ = s => document.querySelector(s);
const AGENTS = {
  giulia:{name:'Giulia',label:'Giulia (Italy Expert)',country:'ITALY',description:'Italian cultural and business intelligence',welcome:'Ciao! What would you like to explore about life, culture, or business in Italy?'},
  mei:{name:'Mei',label:'Mei (Japan Expert)',country:'JAPAN',description:'Japanese cultural and business intelligence',welcome:'Konnichiwa! What would you like to explore about daily life, culture, or business in Japan?'}
};
let selectedAgent='giulia', connections=loadConnections();
const histories={giulia:[],mei:[]}, pending={giulia:false,mei:false}, thinkingRoutes={giulia:null,mei:null}, health={giulia:null,mei:null}, checkIds={giulia:0,mei:0}, runDiagnostics={giulia:null,mei:null}, drafts={giulia:'',mei:''};
const readout=new BrowserSpeech(), readoutPlayer=new AudioPlayer();
let readoutEpoch=0,readoutController=null,readoutGateway=null;
function stopReadout(){
  readoutEpoch++;readoutController?.abort();readout.stop();readoutPlayer.stop();
  $('#readoutStatus').textContent='Speech stopped';
}
async function playReadout(text, agent){
  readoutEpoch++;readoutController?.abort();readout.stop();readoutPlayer.stop();
  const epoch=readoutEpoch, useGateway=$('#preferGatewayReadout').checked;
  if(useGateway&&!readoutGateway){
    $('#readoutStatus').textContent='Kokoro not connected · no generic Microsoft voice substitution';
    $('#readoutGatewayStatus').textContent='Connect the original Kokoro/Seed-VC service using a local or HTTPS endpoint.';
    $('.readout-advanced').open=true;return;
  }
  if(!useGateway&&!hasBrowserSpeech()){ $('#readoutStatus').textContent='Browser speech unavailable. Connect experimental TTS instead.';return; }
  const controller=new AbortController();readoutController=controller;
  $('#readoutStatus').textContent='Reading '+AGENTS[agent].name+(useGateway?' · experimental voice':' · browser voice')+'…';
  try {
    const language=$('#readoutLanguage').value;
    const voice=$('#'+agent+'ReadoutVoice').value;
    if(useGateway&&!voice)throw Error('The speech gateway does not have a configured '+AGENTS[agent].name+' voice.');
    for(const chunk of speechSegments(text,language)){
      if(controller.signal.aborted)break;
      if(useGateway){
        const clip=await readoutGateway.synthesize({text:chunk.text,language:chunk.language,voice,speech:{pace:1}},{signal:controller.signal});
        await readoutPlayer.play(clip.blob,{signal:controller.signal});
      }else{
        await readout.speak({text:chunk.text,language:chunk.language,voice:'browser:default',speech:{pace:1}},{signal:controller.signal});
      }
    }
    if(epoch===readoutEpoch)$('#readoutStatus').textContent='Finished reading';
  }catch(failure){
    if(epoch===readoutEpoch)$('#readoutStatus').textContent=failure.name==='AbortError'?'Speech stopped':('Speech failed: '+failure.message);
  }
}

function countryName(agent){const country=AGENTS[agent].country;return country.charAt(0)+country.slice(1).toLowerCase();}
function thinkingLabel(agent,route){
  const country=countryName(agent);
  if(route==='cultural')return `Thinking about ${country} culture`;
  if(route==='business')return `Thinking about ${country} business`;
  if(route==='both')return `Thinking about ${country} culture + business`;
  if(route==='out_of_scope')return `Checking scope for ${country}`;
  return 'Thinking';
}
function renderMessages(){
  const box=$('#messages');box.replaceChildren();
  if(!histories[selectedAgent].length){const p=document.createElement('p');p.className='system-note';p.textContent=AGENTS[selectedAgent].welcome;box.append(p);}
  for(const m of histories[selectedAgent]){
    const el=document.createElement('div');el.className=`msg ${m.role}`;
    const reply=document.createElement('div');reply.className='reply-text';reply.textContent=m.content;el.append(reply);
    if(m.role==='assistant'&&!m.error){
      const play=document.createElement('button');play.className='read-reply';play.type='button';play.textContent='🔊 Read aloud';
      const agent=selectedAgent;play.setAttribute('aria-label','Read '+AGENTS[agent].name+' reply aloud');
      play.addEventListener('click',()=>playReadout(m.content,agent));el.append(play);
    }
    box.append(el);
  }
  if(pending[selectedAgent]){
    const el=document.createElement('div');el.className='msg assistant thinking-msg';el.setAttribute('role','status');
    const label=document.createElement('span');label.className='thinking-label';label.textContent=thinkingLabel(selectedAgent,thinkingRoutes[selectedAgent]);
    const dots=document.createElement('span');dots.className='thinking-dots';dots.setAttribute('aria-hidden','true');
    for(let i=0;i<3;i++){const dot=document.createElement('span');dots.append(dot);}
    el.append(label,dots);box.append(el);
  }
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
async function requestChat(agent,messages,onProgress){
  const c=connections[agent];if(!c.base)throw new Error('Backend URL is not configured. Open Internal lab tools to connect.');
  const headers={'Content-Type':'application/json','Accept':'application/x-ndjson',...(c.token?{'X-Giulia-Lab-Token':c.token}:{})};
  const res=await fetch(endpointUrl(c.base,'/api/chat'),{method:'POST',headers,body:JSON.stringify({messages}),signal:AbortSignal.timeout(240000)});
  const type=res.headers.get('content-type')||'';
  if(type.includes('application/x-ndjson')&&res.body){
    const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='',result=null;
    const consume=line=>{if(!line.trim())return;const event=JSON.parse(line);if(event.type==='route'&&typeof event.route==='string')onProgress?.(event);else if(event.type==='result')result=event;else if(event.type==='error')throw new Error(event.error||'Backend could not complete the response.');};
    while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines)consume(line);if(done)break;}
    if(buffer.trim())consume(buffer);
    if(!result)throw new Error('Backend ended before returning a result.');
    return result;
  }
  if(!type.includes('application/json'))throw new Error(`Backend returned a non-JSON response (HTTP ${res.status}); check its URL and Vercel access.`);
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
  stopReadout();drafts[selectedAgent]=$('#input').value;selectedAgent=agent;render();
  if(openChat){$('#expertSelection').classList.add('hidden');$('#chatPanel').classList.remove('hidden');$('#input').focus();}
  checkBackend(agent);
}
for(const card of document.querySelectorAll('[data-agent]'))card.addEventListener('click',()=>selectAgent(card.dataset.agent));
$('#changeExpert').addEventListener('click',()=>{stopReadout();$('#chatPanel').classList.add('hidden');$('#expertSelection').classList.remove('hidden');$('#selectionHeading').focus();});
$('#agentSelect').addEventListener('change',()=>selectAgent($('#agentSelect').value,false));
$('#saveConnection').addEventListener('click',()=>{
  const base=$('#backendUrl').value.trim().replace(/\/+$/,'')||defaultBackendFor(selectedAgent);
  if(base){try{const u=new URL(base);if(!['http:','https:'].includes(u.protocol))throw Error();}catch{$('#connectionDetails').textContent='Enter a valid http or https backend URL.';return;}}
  connections[selectedAgent]={base,token:$('#labToken').value.trim()};saveConnections(connections);render();checkBackend();
});
$('#clearConnection').addEventListener('click',()=>{connections[selectedAgent]={base:defaultBackendFor(selectedAgent),token:''};saveConnections(connections);render();checkBackend();});
$('#checkBackend').addEventListener('click',()=>checkBackend());
$('#stopReadout').addEventListener('click',stopReadout);
$('#readoutLanguage').addEventListener('change',stopReadout);
// No model is present on Vercel. A hosted URL must be configured explicitly.
const hostedReadout=location.protocol==='https:'&&!['localhost','127.0.0.1'].includes(location.hostname);
try{
  const previous=localStorage.getItem('voiceLab.gateway');
  if(hostedReadout)$('#readoutGatewayUrl').value=location.origin+'/api/voice';
  else if(previous)$('#readoutGatewayUrl').value=previous;
}catch{if(hostedReadout)$('#readoutGatewayUrl').value=location.origin+'/api/voice';}
$('#readoutGatewayUrl').placeholder=hostedReadout?'Cloud Kokoro is served at /api/voice':'https://your-kokoro-voice-gateway.example';
$('#preferGatewayReadout').addEventListener('change',()=>{
  stopReadout();
  if($('#preferGatewayReadout').checked&&!readoutGateway){
    $('#readoutGatewayStatus').textContent='Kokoro selected but not connected. No generic voices will play until the original gateway is connected.';
    $('.readout-advanced').open=true;
  }else if(!$('#preferGatewayReadout').checked){
    $('#readoutGatewayStatus').textContent='Generic device voices enabled by choice. These are not the Kokoro/Seed-VC research voices.';
  }
});
$('#connectReadoutGateway').addEventListener('click',async()=>{
  stopReadout();
  $('#readoutGatewayStatus').textContent='Connecting to experimental speech service…';
  try{
    const candidate=new VoiceGateway($('#readoutGatewayUrl').value,$('#readoutGatewayToken').value);
    const status=await candidate.status();
    if(status.schemaVersion!==1||!Array.isArray(status.voices)||!status.voices.length)throw Error('No compatible voices provided.');
    if(!/kokoro|seed-?vc/i.test(status.tts?.backend||''))throw Error('This service is not the Kokoro/Seed-VC voice gateway.');
    for(const agent of ['giulia','mei']){
      const selection=$('#'+agent+'ReadoutVoice'),prior=selection.value;
      selection.replaceChildren();
      const agentVoices=status.voices.filter(v=>v.agent===agent);
      if(!agentVoices.length)throw Error('Missing configured '+agent+' Kokoro voice on this gateway.');
      agentVoices.forEach(v=>selection.add(new Option(v.label,v.id)));
      selection.value=agentVoices.find(v=>v.id===prior)?.id
        ||agentVoices.find(v=>v.default)?.id||agentVoices[0].id;
    }
    readoutGateway=candidate;
    $('#preferGatewayReadout').checked=true;
    $('#readoutGatewayStatus').textContent='Original Kokoro gateway connected · '+status.voices.length+' configured voices. Giulia and Mei will use their own voices.';
  }catch(failure){
    readoutGateway=null; // Keep custom voices selected: never revert silently to device TTS.
    $('#readoutGatewayStatus').textContent='Kokoro connection unavailable: '+failure.message+' No browser-voice substitution occurred.';
  }
});
$('#resetChat').addEventListener('click',()=>{if(pending[selectedAgent])return;stopReadout();histories[selectedAgent]=[];runDiagnostics[selectedAgent]=null;drafts[selectedAgent]='';render();$('#input').focus();});
$('#input').addEventListener('input',()=>drafts[selectedAgent]=$('#input').value);
$('#input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chatForm').requestSubmit();}});
$('#chatForm').addEventListener('submit',async e=>{
  e.preventDefault();const agent=selectedAgent,text=$('#input').value.trim();if(!text||pending[agent]||health[agent]?.tone!=='ok')return;
  stopReadout();histories[agent].push({role:'user',content:text});drafts[agent]='';$('#input').value='';thinkingRoutes[agent]=null;pending[agent]=true;renderMessages();renderHealth();
  let completedReply=null;
  try{const d=await requestChat(agent,histories[agent].filter(m=>!m.error),event=>{thinkingRoutes[agent]=event.route;if(selectedAgent===agent)renderMessages();});if(typeof d.reply!=='string'||!d.reply.trim())throw new Error('Backend returned an empty reply.');histories[agent].push({role:'assistant',content:d.reply});completedReply=d.reply;runDiagnostics[agent]={agent,runId:d.runId,route:d.route,diagnostics:d.diagnostics};}
  catch(e){histories[agent].push({role:'assistant',content:`The response could not be completed: ${e.message}`,error:true});}
  finally{pending[agent]=false;thinkingRoutes[agent]=null;if(selectedAgent===agent){render();$('#input').focus();if(completedReply&&$('#autoReadout').checked)void playReadout(completedReply,agent);}}
});
render();
