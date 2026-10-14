import { voiceProxy } from '../../../lib/voice-cloud-proxy.mjs';
export function POST(request) { return voiceProxy(request, 'tts'); }
