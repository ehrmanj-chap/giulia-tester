// Missing diagnostics are unknown, never evidence of zero retrieval.
export function assessRetrieval(diagnostics, route, expectedSources = []) {
  const calls = Array.isArray(diagnostics?.calls) ? diagnostics.calls : [];
  const roles = route === 'both' ? ['cultural', 'business'] : ['cultural', 'business'].includes(route) ? [route] : [];
  const observed = roles.length > 0 && roles.every(role => calls.some(call => call.role === role && Array.isArray(call.retrieval)));
  const rows = calls.flatMap(c => (Array.isArray(c.retrieval) ? c.retrieval : []).map(x => ({role:c.role||null,id:x.id||null,sourceUrl:x.sourceUrl||null,file:x.file||x.title||null,title:x.title||null,chunk:x.chunk??null,score:x.score??null})));
  const hay = rows.map(x => `${x.id||''} ${x.file||''} ${x.title||''}`).join(' ').toLowerCase();
  return {retrieval:rows,retrievalObserved:observed,retrievalPresent:observed?rows.length>0:null,sourceHintPass:observed&&expectedSources.length?expectedSources.some(s=>hay.includes(String(s).toLowerCase())):null};
}
export function giuliaPreflightError(status) {
  if(status.diagnostics !== true) return 'Giulia retrieval diagnostics are unavailable. Set GIULIA_DEV_DIAGNOSTICS=true in Vercel and redeploy before evaluating RAG.';
  if(['cultural','business'].some(role => status.knowledge?.[role]?.documents !== 25 || !(status.knowledge?.[role]?.chunks > 0))) return 'Giulia corpus is missing or incomplete. Expected 25 cultural and 25 business documents with indexed passages. Check /api/status before evaluating RAG.';
  return null;
}
export function ragLabel(result) {
  if(result.error || result.actualRoute === 'out_of_scope') return 'RAG n/a';
  const a=assessRetrieval(result.diagnostics,result.actualRoute);
  return a.retrievalObserved ? `RAG ${a.retrieval.length}` : 'RAG unknown (diagnostics missing)';
}
