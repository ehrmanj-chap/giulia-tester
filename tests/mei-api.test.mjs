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
