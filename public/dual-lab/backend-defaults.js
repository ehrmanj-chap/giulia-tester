export const DEFAULT_BACKENDS = Object.freeze({giulia:'',mei:'https://mei-cultural-agent-kootlefoosh.vercel.app'});
export const CONNECTION_KEY='culturalAgentLab.connections.v2';
const LEGACY_KEY='culturalAgentLab.connections.v1';
export function defaultBackendFor(agentId){
  if(typeof location!=='undefined'&&!location.hostname.endsWith('.github.io'))return agentId==='mei'?`${location.origin}/api/mei`:location.origin;
  return agentId==='mei'?DEFAULT_BACKENDS.mei:DEFAULT_BACKENDS.giulia;
}
export function loadConnections(){
  let saved={},legacy={};try{saved=JSON.parse(localStorage.getItem(CONNECTION_KEY)||'{}');legacy=JSON.parse(localStorage.getItem(LEGACY_KEY)||'{}');}catch{}
  const out={};for(const a of ['giulia','mei']){
    const previous=legacy[a]||{};let base=saved[a]?.base??previous.base??defaultBackendFor(a);
    if(!saved[a]&&a==='mei'&&base===DEFAULT_BACKENDS.mei&&typeof location!=='undefined'&&!location.hostname.endsWith('.github.io'))base=defaultBackendFor(a);
    out[a]={base:String(base||defaultBackendFor(a)).replace(/\/+$/,''),token:saved[a]?.token??previous.token??''};
  }
  if(!saved.mei&&typeof location!=='undefined'&&location.hostname.endsWith('.github.io')&&out.giulia.base)out.mei.base=`${out.giulia.base}/api/mei`;
  return out;
}
export function saveConnections(connections){try{localStorage.setItem(CONNECTION_KEY,JSON.stringify(connections));return true;}catch{return false;}}

export function endpointUrl(base, apiPath) {
  return base.endsWith('/api/mei') ? `${base}${apiPath.replace(/^\/api/, '')}` : `${base}${apiPath}`;
}
