export const DEFAULT_BACKENDS = Object.freeze({
  giulia: '',
  mei: 'https://mei-cultural-agent-kootlefoosh.vercel.app'
});

export function defaultBackendFor(agentId) {
  if (agentId === 'mei') return DEFAULT_BACKENDS.mei;
  if (agentId !== 'giulia') return '';

  // Giulia historically used the same origin as the tester when served by
  // the local Node server (or another backend-capable host). GitHub Pages is
  // static, so only Pages should require an explicit remote Giulia backend.
  if (typeof location !== 'undefined') {
    const host = location.hostname || '';
    if (!host.endsWith('.github.io')) return location.origin;
  }
  return DEFAULT_BACKENDS.giulia;
}
