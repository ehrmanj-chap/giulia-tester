import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {endpointUrl} from '../public/dual-lab/backend-defaults.js';

test('standalone and integrated Mei URLs preserve the API path exactly once',()=>{
 assert.equal(endpointUrl('https://lab.example/api/mei','/api/status'),'https://lab.example/api/mei/status');
 assert.equal(endpointUrl('https://mei.example','/api/chat'),'https://mei.example/api/chat');
 assert.equal(endpointUrl('https://lab.example','/api/status'),'https://lab.example/api/status');
});
test('Mei HTTP handler preserves token auth and sends bounded source evidence to the provider',async()=>{
 const captures=[];
 const provider=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;captures.push(JSON.parse(raw));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({model:'offline-fixture',choices:[{message:{content:'Offline integration response.'}}]}));});
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));
 process.env.DASHSCOPE_API_KEY='offline-fixture';process.env.QWEN_BASE_URL=`http://127.0.0.1:${provider.address().port}`;process.env.MEI_LAB_TOKEN='test-token';
 const {default:handler}=await import('../mei-backend/server.mjs');
 const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/api/status')).status,401);
  const headers={'X-Mei-Lab-Token':'test-token','Content-Type':'application/json'};
  const status=await(await fetch(base+'/api/status',{headers})).json();assert.equal(status.knowledge.cultural.documents,74);assert.equal(status.knowledge.business.documents,80);
  const response=await(await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({messages:[{role:'user',content:'How can a foreign student open a bank account?'}]})})).json();
  assert.equal(response.reply,'Offline integration response.');assert.equal(response.route,'cultural');assert.equal(captures.length,1);
  const sys=captures[0].messages[0].content;assert.ok(sys.includes('Opening a Bank Account'));assert.ok(sys.includes('SOURCE:'));assert.ok(sys.length<30000);
  const sources=response.diagnostics.calls[0].retrieval;assert.ok(sources.every(s=>s.id&&s.sourceUrl&&Number.isInteger(s.chunk)));
 }finally{server.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>provider.close(r))]);}
});

test('Mei inherits Giulia token protection when a Mei token is not configured',async()=>{
 const {spawn}=await import('node:child_process');
 const code=`process.env.GIULIA_LAB_TOKEN='inherited-token';delete process.env.MEI_LAB_TOKEN;process.env.DASHSCOPE_API_KEY='fixture';process.env.QWEN_BASE_URL='https://example.invalid';const http=await import('node:http');const {default:handler}=await import('./mei-backend/server.mjs');const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;try{const denied=await fetch(base+'/api/status');const accepted=await fetch(base+'/api/status',{headers:{'X-Giulia-Lab-Token':'inherited-token'}});if(denied.status!==401||accepted.status!==200)process.exitCode=1;}finally{server.closeAllConnections();server.close();}`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:new URL('..',import.meta.url),stdio:'pipe'});let error='';child.stderr.on('data',b=>error+=b);const codeResult=await new Promise(r=>child.on('exit',r));assert.equal(codeResult,0,error);
});
