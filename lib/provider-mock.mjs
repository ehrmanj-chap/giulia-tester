import { latestUserMessage } from './utils.mjs';

function routeFor(text) {
  const t = text.toLowerCase();
  if (/\b(?:weather|forecast|visa|hotel availability|train schedule|flight schedule)\b/.test(t)) return 'out_of_scope';
  const italy = /(italy|italian|italia|milan|milano|rome|roma|naples|napoli|bologna|florence|firenze|venice|venezia|sicily|sicilia|sardinia|sardegna|turin|torino|tuscany|toscana|lombardy|veneto)/.test(t);
  if (!italy) return 'out_of_scope';
  const business = /\b(?:work|workplace|manager|meeting|office|intern|company|business|contract|gdp|economy|economic|tax|client|professional|market|salary|labor|labour|trade|fdi|investment|supplier|legal|compliance|hiring|negotiation|negotiations|corporate|governance|succession|companies|ownership|srl|spa|forming|formation|incorporation)\b|regulat/.test(t);
  const cultural = /(culture|etiquette|family|friend|dating|gesture|religion|language|dialect|social|restaurant|dinner|greeting|tradition|regional|campanilismo|bella figura|food|church|catholic|foreigners|biennale|relationship|relationship-building)/.test(t);
  const mixed = /(culture|social|regional|family|campanilismo|bella figura|etiquette|relationship|relationship-building).*(business|company|companies|supplier|market|negotiat|workplace|manager|governance|succession|ownership)|(?:business|company|companies|supplier|market|negotiat|workplace|manager|governance|succession|ownership).*(culture|social|regional|family|campanilismo|bella figura|etiquette|relationship|relationship-building)/.test(t);
  if (business && cultural && mixed) return 'both';
  if (business) return 'business';
  if (cultural) return 'cultural';
  return 'cultural';
}

export class MockProvider {
  constructor(config) { this.config = config; this.name = 'mock'; }
  async complete({ messages, model = 'mock-model' }) {
    const system = String(messages?.[0]?.content || '');
    const user = latestUserMessage(messages);
    const conversationText = messages.filter(m => m?.role !== 'system').map(m => String(m.content || '')).join('\n');
    let content;
    if (system.includes('ROUTER_GIULIA')) {
      const route = routeFor(conversationText);
      content = JSON.stringify({ route, confidence: route === 'out_of_scope' ? 0.78 : 0.91, reason: 'mock deterministic scope routing' });
    } else if (system.includes('SYNTHESIS_GIULIA')) content = `Mock unified Giulia synthesis for: ${user}`;
    else if (system.includes('CULTURAL_GIULIA')) content = `Mock Giulia cultural answer for: ${user}`;
    else if (system.includes('BUSINESS_GIULIA')) content = `Mock Giulia business answer for: ${user}`;
    else content = `Mock Giulia answer for: ${user}`;
    return { content, model, usage: { mock: true }, latencyMs: 1, rawId: null };
  }
}
