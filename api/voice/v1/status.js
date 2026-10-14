import { voiceProxy } from '../../../lib/voice-cloud-proxy.mjs';
export function GET(request) { return voiceProxy(request, 'status'); }
